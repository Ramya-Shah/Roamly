"""
Standard microstructural market-making formulations for Project Alpha-Forge.

Every AI-synthesized strategy placed in ``sandbox_workspace/`` MUST subclass one
of the templates defined here. This guarantees that generated code always
exposes the same ``compute_quotes`` contract that ``backtest_runner.py`` drives
tick-by-tick, and that inventory-risk clamping is applied uniformly regardless
of what the LLM writes in its override.

Two closed-form baselines are provided:

1. ``AvellanedaStoikovStrategy`` - the classical finite-horizon inventory model.
2. ``GLFTStrategy`` - the Gueant-Lehalle-Fernandez-Tapia linear-skew
   approximation, suited to assets with an undefined/rolling horizon.
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class RiskParameters:
    """Calibrated/assumed market and risk-aversion constants.

    Attributes:
        gamma: Inventory risk-aversion coefficient (:math:`\\gamma`). Higher
            values shrink quotes toward flat inventory more aggressively.
        sigma: Instantaneous mid-price volatility (:math:`\\sigma`), in price
            units per :math:`\\sqrt{\\text{time unit}}`.
        k: LOB liquidity/order-arrival decay parameter (:math:`k`), typically
            produced by ``fetch_regime_calibration`` in ``mcp_server.py``.
        A: Baseline order-arrival intensity (:math:`A`) from the same
            calibration fit, used by the GLFT closed-form constants.
        T: Total trading horizon, in the same time unit as ``t``.
        q_max: Absolute inventory bound. Quotes are skewed asymmetrically
            (one side widened, the other tightened) once |inventory|
            approaches this bound, and one side is fully withdrawn if it is
            breached, as an inventory-explosion safeguard.
        order_size: Default resting size quoted on each side.
    """

    gamma: float
    sigma: float
    k: float
    A: float = 1.0
    T: float = 1.0
    q_max: float = 100.0
    order_size: float = 1.0

    def __post_init__(self) -> None:
        if self.gamma <= 0:
            raise ValueError("gamma must be strictly positive")
        if self.sigma < 0:
            raise ValueError("sigma must be non-negative")
        if self.k <= 0:
            raise ValueError("k must be strictly positive")
        if self.A <= 0:
            raise ValueError("A must be strictly positive")
        if self.T <= 0:
            raise ValueError("T must be strictly positive")
        if self.q_max <= 0:
            raise ValueError("q_max must be strictly positive")
        if self.order_size <= 0:
            raise ValueError("order_size must be strictly positive")


@dataclass(frozen=True, slots=True)
class QuoteSet:
    """A single two-sided quote decision for the current tick."""

    bid_price: float
    ask_price: float
    bid_size: float
    ask_size: float

    def __post_init__(self) -> None:
        if self.bid_price <= 0 or self.ask_price <= 0:
            raise ValueError("quoted prices must be strictly positive")
        if self.bid_price >= self.ask_price:
            raise ValueError("bid_price must be strictly less than ask_price")
        if self.bid_size < 0 or self.ask_size < 0:
            raise ValueError("quoted sizes must be non-negative")


class BaseMarketMakingStrategy(ABC):
    """Abstract base every generated strategy must inherit.

    Subclasses implement :meth:`_reservation_and_spread`, which returns the
    theoretical (reservation_price, half_spread_bid, half_spread_ask) triple
    for the current state. This base class then applies a uniform
    inventory-explosion clamp before emitting the final :class:`QuoteSet`,
    so that a buggy or adversarial override in AI-generated code cannot
    remove the safety rail entirely.
    """

    def __init__(self, risk_params: RiskParameters) -> None:
        self.risk_params = risk_params

    @property
    def risk_parameters(self) -> RiskParameters:
        """Alias for :attr:`risk_params`.

        AI-generated overrides of ``_reservation_and_spread`` sometimes guess
        this longer spelling (matching the ``RiskParameters`` class name)
        instead of the actual constructor-argument name. Accepting both costs
        nothing and saves a full synthesis/audit/execution retry cycle for a
        pure naming mismatch that has no bearing on strategy correctness.
        """
        return self.risk_params

    @abstractmethod
    def _reservation_and_spread(
        self, mid_price: float, inventory: float, t: float
    ) -> tuple[float, float, float]:
        """Return (reservation_price, delta_bid, delta_ask) for this tick.

        ``delta_bid``/``delta_ask`` are one-sided offsets from the
        reservation price (both non-negative): bid = reservation - delta_bid,
        ask = reservation + delta_ask.
        """
        raise NotImplementedError

    def _inventory_clamp_scale(self, inventory: float) -> tuple[float, float]:
        """Asymmetric size multipliers (bid_scale, ask_scale) in [0, 1].

        As inventory approaches ``+q_max`` the strategy should stop buying
        (bid_scale -> 0) while still being willing to sell (ask_scale stays
        at 1), and symmetrically for ``-q_max``. This is the mechanical
        counterpart to the "Inventory Explosion Warning" safeguard: even if
        an LLM-authored override forgets to widen its own spread, resting
        size on the runaway side collapses to zero at the hard bound.
        """
        q = self.risk_params.q_max
        utilization = max(-1.0, min(1.0, inventory / q))
        bid_scale = max(0.0, 1.0 - max(0.0, utilization))
        ask_scale = max(0.0, 1.0 + min(0.0, utilization))
        return bid_scale, ask_scale

    def compute_quotes(self, mid_price: float, inventory: float, t: float) -> QuoteSet:
        """Produce the tick's two-sided quote, with inventory clamping applied.

        Args:
            mid_price: Current LOB mid-price (:math:`s`).
            inventory: Signed current inventory position (:math:`q`).
            t: Elapsed time since session start, same unit as ``T``.
        """
        if mid_price <= 0:
            raise ValueError("mid_price must be strictly positive")
        t_clamped = max(0.0, min(t, self.risk_params.T))

        reservation, delta_bid, delta_ask = self._reservation_and_spread(
            mid_price, inventory, t_clamped
        )
        delta_bid = max(delta_bid, 0.0)
        delta_ask = max(delta_ask, 0.0)

        bid_price = reservation - delta_bid
        ask_price = reservation + delta_ask
        if bid_price <= 0:
            bid_price = mid_price * 1e-6

        bid_scale, ask_scale = self._inventory_clamp_scale(inventory)
        size = self.risk_params.order_size

        return QuoteSet(
            bid_price=bid_price,
            ask_price=ask_price,
            bid_size=size * bid_scale,
            ask_size=size * ask_scale,
        )


class AvellanedaStoikovStrategy(BaseMarketMakingStrategy):
    """Classical finite-horizon Avellaneda-Stoikov (2008) inventory model.

    Reservation price:

    .. math::
        r(s, q, t) = s - q \\, \\gamma \\, \\sigma^2 \\, (T - t)

    Symmetric total optimal spread:

    .. math::
        \\delta_b(q) + \\delta_a(q)
            = \\gamma \\sigma^2 (T - t) + \\frac{2}{\\gamma}
              \\ln\\!\\left(1 + \\frac{\\gamma}{k}\\right)

    The reservation price shifts away from the mid-price in the direction
    opposite the current inventory (selling pressure when long, buying
    pressure when short), while the total spread widens both as the
    remaining horizon :math:`T - t` grows and as inventory risk-aversion
    :math:`\\gamma` or volatility :math:`\\sigma` increases. The spread is
    split symmetrically around the reservation price, i.e.
    :math:`\\delta_b = \\delta_a = \\tfrac{1}{2}(\\delta_b + \\delta_a)`.
    """

    def _reservation_and_spread(
        self, mid_price: float, inventory: float, t: float
    ) -> tuple[float, float, float]:
        p = self.risk_params
        time_remaining = p.T - t

        reservation_price = mid_price - inventory * p.gamma * (p.sigma ** 2) * time_remaining

        total_spread = (
            p.gamma * (p.sigma ** 2) * time_remaining
            + (2.0 / p.gamma) * math.log(1.0 + p.gamma / p.k)
        )
        half_spread = max(total_spread, 0.0) / 2.0

        return reservation_price, half_spread, half_spread


class GLFTStrategy(BaseMarketMakingStrategy):
    """Gueant-Lehalle-Fernandez-Tapia continuous linear-skew approximation.

    Used when the trading horizon is undefined or effectively infinite
    (``T`` is treated as a rolling normalization window rather than a hard
    terminal time). Quotes are expressed as linear functions of inventory
    around the mid-price directly, with no separate reservation-price shift:

    .. math::
        \\delta_b(q) = \\text{half\\_spread} + \\text{skew} \\cdot q, \\qquad
        \\delta_a(q) = \\text{half\\_spread} - \\text{skew} \\cdot q

    .. math::
        \\text{half\\_spread} = C_1 + \\frac{\\sigma \\, C_2}{2}, \\qquad
        \\text{skew} = \\sigma \\, C_2

    where the closed-form risk constants are derived from the calibrated
    liquidity parameters :math:`(\\gamma, k, A)`:

    .. math::
        C_1 = \\frac{1}{\\gamma} \\ln\\!\\left(1 + \\frac{\\gamma}{k}\\right),
        \\qquad
        C_2 = \\sqrt{\\frac{\\gamma}{2 \\, A \\, k}}

    Long inventory (:math:`q > 0`) increases :math:`\\delta_b` (quotes a
    less aggressive/further bid, discouraging further buying) and decreases
    :math:`\\delta_a` (quotes closer to mid on the ask, encouraging
    liquidation) - and symmetrically for short inventory.
    """

    def _reservation_and_spread(
        self, mid_price: float, inventory: float, t: float
    ) -> tuple[float, float, float]:
        p = self.risk_params

        c1 = (1.0 / p.gamma) * math.log(1.0 + p.gamma / p.k)
        c2 = math.sqrt(p.gamma / (2.0 * p.A * p.k))

        half_spread = c1 + (p.sigma * c2) / 2.0
        skew = p.sigma * c2

        delta_bid = max(half_spread + skew * inventory, 0.0)
        delta_ask = max(half_spread - skew * inventory, 0.0)

        # GLFT quotes are defined directly around the mid-price; there is no
        # separate reservation-price shift, so reservation == mid_price here.
        return mid_price, delta_bid, delta_ask


STRATEGY_REGISTRY: dict[str, type[BaseMarketMakingStrategy]] = {
    "avellaneda_stoikov": AvellanedaStoikovStrategy,
    "glft": GLFTStrategy,
}


def build_strategy(name: str, risk_params: RiskParameters) -> BaseMarketMakingStrategy:
    """Factory used by ``backtest_runner.py`` to instantiate a named baseline.

    AI-generated strategy files are expected to import and subclass
    :class:`AvellanedaStoikovStrategy` or :class:`GLFTStrategy` directly
    rather than going through this registry; this factory exists for
    running the unmodified baselines as a benchmark comparison.
    """
    try:
        strategy_cls = STRATEGY_REGISTRY[name]
    except KeyError as exc:
        valid = ", ".join(sorted(STRATEGY_REGISTRY))
        raise ValueError(f"Unknown strategy '{name}'. Valid options: {valid}") from exc
    return strategy_cls(risk_params)
