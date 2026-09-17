import { GoogleGenAI } from '@google/genai';
import { ServerExperienceRepository } from '../repositories/experienceRepo';
import {
  AIPlanRequest,
  GeneratedPlan,
  AIPlanStop,
  RegeneratePlanRequest,
  Experience,
} from '../types';
import {
  rankCandidates,
  ScoredCandidate,
  haversineDistance,
} from './candidateRanker';
import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  buildRegenerateUserPrompt,
  buildDynamicCitySystemPrompt,
  buildDynamicCityUserPrompt,
  buildDynamicCityRegenerateUserPrompt,
} from '../ai/prompts/planner';
import { memoryStore, prisma } from '../db/client';

const PRESEEDED_CITIES = new Set([
  'bengaluru',
  'bangalore',
  'mumbai',
  'bombay',
  'london',
  'ahmedabad',
  'amdavad',
]);

function isPreseededCity(city: string): boolean {
  return PRESEEDED_CITIES.has(city.trim().toLowerCase());
}

export class GeminiPlannerService {
  private expRepo = new ServerExperienceRepository();

  /**
   * Generates a personalized itinerary.
   * If GEMINI_API_KEY is present and valid, uses Gemini.
   * Otherwise gracefully falls back to deterministic heuristic planning.
   */
  async generatePlan(request: AIPlanRequest): Promise<GeneratedPlan> {
    console.log(`\n========================================`);
    console.log(`🤖 [Roamly AI] New Plan Request: ${request.city}`);
    console.log(`   Time: ${request.availableMinutes} mins | Budget: ${request.budget} | Interests: ${request.interests.join(', ') || 'Any'}`);

    const allExperiences = await this.expRepo.getExperiences({ city: request.city });
    const candidates = rankCandidates(allExperiences, request, 12);
    console.log(`📊 [Roamly AI] Pre-ranked ${candidates.length} candidates using multi-factor formula`);

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const isPreseeded = isPreseededCity(request.city);

    // If city is not pre-seeded or has no experiences in the database,
    // Gemini dynamically discovers authentic venues across the entire city!
    if (!isPreseeded || candidates.length === 0) {
      if (!apiKey) {
        if (candidates.length > 0) {
          const fallbackPlan = this.generateDeterministicPlan(candidates, request);
          await this.persistPlan(fallbackPlan);
          return fallbackPlan;
        }
        throw new Error(
          `Offline itineraries are currently pre-cached for Bengaluru, Mumbai, London, and Ahmedabad. Connect to the internet with AI enabled to generate itineraries for ${request.city}.`
        );
      }
      console.log(`🌐 [Roamly AI] Dynamically discovering venues across ALL of "${request.city}" via Gemini...`);
      return await this.generateDynamicCityPlan(request, apiKey, modelName);
    }
    if (apiKey) {
      const modelsToTry = [modelName, 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
      const startTime = Date.now();
      const ai = new GoogleGenAI({ apiKey });
      const systemPrompt = buildPlannerSystemPrompt();
      const userPrompt = buildPlannerUserPrompt(request, candidates);

      for (const m of modelsToTry) {
        try {
          console.log(`✨ [Roamly AI] Contacting Google Gemini (${m}) with candidate pool...`);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Gemini API call timed out after 15s')), 15000)
          );

          const response: any = await Promise.race([
            ai.models.generateContent({
              model: m,
              contents: userPrompt,
              config: {
                systemInstruction: systemPrompt,
                responseMimeType: 'application/json',
              },
            }),
            timeoutPromise,
          ]);

          const rawText = response.text || '';
          const parsed = JSON.parse(rawText);

          const validPlan = this.validateAndHydrateAIResponse(
            parsed,
            candidates,
            request
          );

          if (validPlan) {
            const elapsed = Date.now() - startTime;
            console.log(`✅ [Roamly AI] Gemini (${m}) responded in ${elapsed}ms!`);
            console.log(`   Title: "${validPlan.title}" (${validPlan.stops.length} stops, est. cost: ${validPlan.estimatedCost})`);
            console.log(`========================================\n`);
            await this.persistPlan(validPlan);
            return validPlan;
          } else {
            console.warn(`⚠️ [Roamly AI] Response could not be validated against candidate IDs.`);
          }
        } catch (err: any) {
          console.warn(`⚠️ [Roamly AI] Gemini (${m}) error: ${err.message || err}. Trying next model...`);
        }
      }
      console.log(`🔄 [Roamly AI] Seamlessly falling back to local deterministic planner.`);
    } else {
      console.log(`ℹ️ [Roamly AI] No GEMINI_API_KEY found. Running deterministic offline planner.`);
    }

    // Deterministic fallback plan
    const fallbackPlan = this.generateDeterministicPlan(candidates, request);
    console.log(`✅ [Roamly AI] Fallback Plan Generated: "${fallbackPlan.title}" (${fallbackPlan.stops.length} stops)`);
    console.log(`========================================\n`);
    await this.persistPlan(fallbackPlan);
    return fallbackPlan;
  }

  /**
   * Regenerates a plan applying a modifier (e.g. 'more_relaxed', 'cheaper', etc.)
   */
  async regeneratePlan(request: RegeneratePlanRequest): Promise<GeneratedPlan> {
    const planRequest: AIPlanRequest = request.currentPlan.requestParams || {
      city: request.city,
      location: request.location || {
        latitude: request.currentPlan.stops[0]?.experience?.latitude || 12.9716,
        longitude: request.currentPlan.stops[0]?.experience?.longitude || 77.5946,
      },
      availableMinutes: 300,
      budget: request.currentPlan.estimatedCost || 1000,
      interests: [],
      preferences: [],
    };

    // Adjust parameters according to modifier
    if (request.modifier === 'cheaper') {
      planRequest.budget = Math.floor(planRequest.budget * 0.5);
    } else if (request.modifier === 'more_relaxed') {
      planRequest.availableMinutes = Math.min(720, planRequest.availableMinutes + 60);
    }

    console.log(`\n========================================`);
    console.log(`🤖 [Roamly AI] Regeneration Requested: ${request.modifier.toUpperCase()}`);
    console.log(`   Base Plan: "${request.currentPlan.title}" (${request.city})`);

    const allExperiences = await this.expRepo.getExperiences({ city: request.city });
    const candidates = rankCandidates(allExperiences, planRequest, 15);

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const isPreseeded = isPreseededCity(request.city);

    // If city is not pre-seeded (or has fewer than 8 candidates),
    // Gemini must search amongst ALL places across the city to discover fresh alternative venues!
    if (!isPreseeded || candidates.length < 8) {
      if (!apiKey) {
        if (candidates.length > 0) {
          const regenerated = this.generateDeterministicPlan(
            candidates,
            planRequest,
            request.modifier
          );
          await this.persistPlan(regenerated);
          return regenerated;
        }
        throw new Error(
          `Offline itineraries are currently pre-cached for Bengaluru, Mumbai, London, and Ahmedabad. Connect to the internet with AI enabled to regenerate itineraries for ${request.city}.`
        );
      }
      console.log(`🌐 [Roamly AI] Dynamically searching ALL places across "${request.city}" to apply modifier: ${request.modifier}...`);
      const currentStopTitles = request.currentPlan.stops
        .map((s) => s.experience?.title || '')
        .filter(Boolean);

      const dynamicPrompt = buildDynamicCityRegenerateUserPrompt(
        request.currentPlan.title,
        currentStopTitles,
        request.modifier,
        planRequest
      );

      return await this.generateDynamicCityPlan(
        {
          ...planRequest,
          preferences: [...planRequest.preferences, request.modifier],
        },
        apiKey,
        modelName,
        dynamicPrompt
      );
    }

    if (apiKey) {
      const modelsToTry = [modelName, 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
      const startTime = Date.now();
      const ai = new GoogleGenAI({ apiKey });
      const currentStopIds = request.currentPlan.stops.map((s) => s.experienceId);
      const userPrompt = buildRegenerateUserPrompt(
        request.currentPlan.title,
        currentStopIds,
        request.modifier,
        planRequest,
        candidates
      );

      for (const m of modelsToTry) {
        try {
          console.log(`✨ [Roamly AI] Contacting Gemini (${m}) to apply modifier: ${request.modifier}...`);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Gemini regenerate timed out after 15s')), 15000)
          );

          const response: any = await Promise.race([
            ai.models.generateContent({
              model: m,
              contents: userPrompt,
              config: {
                systemInstruction: buildPlannerSystemPrompt(),
                responseMimeType: 'application/json',
              },
            }),
            timeoutPromise,
          ]);

          const rawText = response.text || '';
          const parsed = JSON.parse(rawText);

          const validPlan = this.validateAndHydrateAIResponse(
            parsed,
            candidates,
            planRequest
          );

          if (validPlan) {
            const elapsed = Date.now() - startTime;
            console.log(`✅ [Roamly AI] Gemini regenerated plan in ${elapsed}ms: "${validPlan.title}"!`);
            console.log(`========================================\n`);
            await this.persistPlan(validPlan);
            return validPlan;
          }
        } catch (err: any) {
          console.warn(`⚠️ [Roamly AI] Gemini regenerate on model ${m} failed (${err.message || err}). Trying next candidate...`);
        }
      }
    }

    // Deterministic modified plan
    const modifiedCandidates = candidates.filter((c) => {
      if (request.modifier === 'cheaper') {
        return c.experience.priceTier === 'Free' || c.experience.priceTier === '$';
      }
      if (request.modifier === 'more_food') {
        return (
          c.experience.category.toLowerCase() === 'food' ||
          (c.experience.tags && c.experience.tags.some((t) => t.toLowerCase().includes('food')))
        );
      }
      if (request.modifier === 'more_cultural') {
        return (
          c.experience.category.toLowerCase() === 'museums' ||
          c.experience.category.toLowerCase() === 'attractions'
        );
      }
      return true;
    });

    const candidatePool =
      modifiedCandidates.length >= 2 ? modifiedCandidates : candidates;

    const regenerated = this.generateDeterministicPlan(
      candidatePool,
      planRequest,
      request.modifier
    );
    await this.persistPlan(regenerated);
    return regenerated;
  }

  /**
   * Dynamically generates an itinerary for any city (e.g. Ahmedabad, Jaipur, Paris)
   * using Gemini AI when the city is not pre-seeded in the local database.
   */
  public async generateDynamicCityPlan(
    request: AIPlanRequest,
    apiKey: string,
    modelName: string,
    customUserPrompt?: string
  ): Promise<GeneratedPlan> {
    console.log(
      `✨ [Roamly AI] Querying Gemini for dynamic ${request.city} experience discovery (${
        customUserPrompt ? 'Adjustment Discovery' : 'Initial Exploration'
      })...`
    );
    const startTime = Date.now();
    const ai = new GoogleGenAI({ apiKey });
    const systemPrompt = buildDynamicCitySystemPrompt();
    const userPrompt = customUserPrompt || buildDynamicCityUserPrompt(request);

    const modelsToTry = [modelName, 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
    let lastError: any = null;
    let response: any = null;

    for (const m of modelsToTry) {
      try {
        console.log(`✨ [Roamly AI] Attempting model: ${m}...`);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Gemini dynamic city planner timed out after 18s`)),
            18000
          )
        );

        response = await Promise.race([
          ai.models.generateContent({
            model: m,
            contents: userPrompt,
            config: {
              systemInstruction: systemPrompt,
              responseMimeType: 'application/json',
            },
          }),
          timeoutPromise,
        ]);

        if (response?.text) break;
      } catch (err: any) {
        lastError = err;
        console.warn(
          `⚠️ [Roamly AI] Model ${m} busy or unavailable (${err.message || err}). Trying next candidate...`
        );
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error(`Gemini could not generate an itinerary for ${request.city}`);
    }

    const rawText = response.text || '';
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(`Invalid JSON response from Gemini for ${request.city}`);
    }

    if (!parsed || !Array.isArray(parsed.stops) || parsed.stops.length === 0) {
      throw new Error(`Gemini could not generate valid itinerary stops for ${request.city}`);
    }

    const stops: AIPlanStop[] = [];
    let totalCost = 0;
    let totalTravelMinutes = 0;

    const defaultImagesByCategory: Record<string, string> = {
      Food: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&auto=format&fit=crop&q=80',
      Attractions: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?w=800&auto=format&fit=crop&q=80',
      Parks: 'https://images.unsplash.com/photo-1569437061241-a848be43cc82?w=800&auto=format&fit=crop&q=80',
      Museums: 'https://images.unsplash.com/photo-1582510003544-4d00b7f74220?w=800&auto=format&fit=crop&q=80',
      Adventure: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=800&auto=format&fit=crop&q=80',
      Nightlife: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&auto=format&fit=crop&q=80',
    };

    for (let i = 0; i < parsed.stops.length; i++) {
      const rawStop = parsed.stops[i];
      const rawExp = rawStop.experience || {};
      const safeCityPrefix = request.city.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const cleanTitle = (rawExp.title || `${request.city} Sight ${i + 1}`).trim();

      // Check if an experience with this title already exists in memoryStore
      const existingExp = Array.from(memoryStore.experiences.values()).find(
        (e) =>
          e.city.toLowerCase() === request.city.toLowerCase() &&
          e.title.toLowerCase().trim() === cleanTitle.toLowerCase()
      );

      const expId = existingExp?.id || `dyn-${safeCityPrefix}-${Date.now()}-${i + 1}`;
      const category = rawExp.category || existingExp?.category || 'Attractions';
      const fallbackImage =
        defaultImagesByCategory[category] || defaultImagesByCategory.Attractions;

      const exp: Experience = {
        id: expId,
        title: cleanTitle,
        description:
          rawExp.description ||
          existingExp?.description ||
          `Famous destination in ${request.city} curated by Roamly AI.`,
        category: category,
        city: request.city,
        latitude:
          Number(rawExp.latitude) ||
          existingExp?.latitude ||
          request.location.latitude ||
          23.0225,
        longitude:
          Number(rawExp.longitude) ||
          existingExp?.longitude ||
          request.location.longitude ||
          72.5714,
        address: rawExp.address || existingExp?.address || `${request.city} Center`,
        rating: Number(rawExp.rating) || existingExp?.rating || 4.7,
        reviewCount: Number(rawExp.reviewCount) || existingExp?.reviewCount || 1200,
        priceTier:
          rawExp.priceTier ||
          existingExp?.priceTier ||
          (rawExp.priceAmount > 500 ? '$$' : rawExp.priceAmount > 0 ? '$' : 'Free'),
        priceAmount: Number(rawExp.priceAmount) ?? existingExp?.priceAmount ?? 0,
        durationMinutes:
          Number(rawExp.durationMinutes) ||
          Number(rawStop.durationMinutes) ||
          existingExp?.durationMinutes ||
          60,
        openingHours: rawExp.openingHours || existingExp?.openingHours || '09:00 - 19:00',
        imageUrl:
          rawExp.imageUrl && !rawExp.imageUrl.includes('photo-1506744038136')
            ? rawExp.imageUrl
            : existingExp?.imageUrl || fallbackImage,
        tags:
          Array.isArray(rawExp.tags) && rawExp.tags.length > 0
            ? rawExp.tags
            : existingExp?.tags || [category, request.city],
        isFeatured: i === 0,
      };

      // Save into memoryStore so experience lookups and future plans find it
      memoryStore.experiences.set(exp.id, exp);

      if (process.env.DATABASE_URL) {
        prisma.experience
          .upsert({
            where: { id: exp.id },
            create: {
              id: exp.id,
              title: exp.title,
              description: exp.description,
              category: exp.category,
              city: exp.city,
              latitude: exp.latitude,
              longitude: exp.longitude,
              address: exp.address,
              rating: exp.rating,
              reviewCount: exp.reviewCount,
              priceTier: exp.priceTier,
              priceAmount: exp.priceAmount,
              durationMinutes: exp.durationMinutes,
              openingHours: exp.openingHours,
              imageUrl: exp.imageUrl,
              tags: exp.tags,
              isFeatured: exp.isFeatured,
            },
            update: {
              title: exp.title,
              description: exp.description,
            },
          })
          .catch(() => {});
      }

      totalCost += exp.priceAmount;
      if (i > 0) {
        const prev = stops[i - 1].experience!;
        const dist = haversineDistance(
          prev.latitude,
          prev.longitude,
          exp.latitude,
          exp.longitude
        );
        totalTravelMinutes += Math.max(10, Math.round(dist * 2.5));
      }

      stops.push({
        experienceId: exp.id,
        startTime: rawStop.startTime || `${10 + i * 2}:00`,
        durationMinutes: exp.durationMinutes,
        reason:
          rawStop.reason ||
          `Curated for your day in ${request.city} based on your interests.`,
        experience: exp,
      });
    }

    const plan: GeneratedPlan = {
      id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: parsed.title || `${request.city} Day Adventure`,
      summary:
        parsed.summary ||
        `An authentic ${stops.length}-stop journey through ${request.city} customized for your schedule.`,
      city: request.city,
      stops,
      estimatedCost: parsed.estimatedCost || totalCost,
      estimatedTravelMinutes: parsed.estimatedTravelMinutes || totalTravelMinutes || 25,
      createdAt: new Date().toISOString(),
      requestParams: request,
    };

    const elapsed = Date.now() - startTime;
    console.log(
      `✅ [Roamly AI] Gemini created dynamic plan for ${request.city} in ${elapsed}ms: "${plan.title}" (${stops.length} stops, est. cost: ${plan.estimatedCost})`
    );
    console.log(`========================================\n`);

    await this.persistPlan(plan);
    return plan;
  }


  /**
   * Validates Gemini structured output strictly against known candidate IDs
   * and hydrates each stop with the full Experience model.
   */
  private validateAndHydrateAIResponse(
    parsed: any,
    candidates: ScoredCandidate[],
    request: AIPlanRequest
  ): GeneratedPlan | null {
    if (!parsed || !Array.isArray(parsed.stops) || parsed.stops.length === 0) {
      return null;
    }

    const candidateMap = new Map<string, Experience>();
    for (const c of candidates) {
      candidateMap.set(c.experience.id, c.experience);
    }

    const hydratedStops: AIPlanStop[] = [];
    const usedIds = new Set<string>();

    for (const rawStop of parsed.stops) {
      const exp = candidateMap.get(rawStop.experienceId);
      if (exp && !usedIds.has(exp.id)) {
        usedIds.add(exp.id);
        hydratedStops.push({
          experienceId: exp.id,
          startTime: rawStop.startTime || '10:00',
          durationMinutes: Number(rawStop.durationMinutes) || exp.durationMinutes || 90,
          reason:
            rawStop.reason ||
            `Curated for ${request.city} based on your interests in ${request.interests.join(', ') || 'top sights'}.`,
          experience: exp,
        });
      }
    }

    if (hydratedStops.length === 0) {
      return null;
    }

    // Re-calculate travel time and cost
    let totalCost = 0;
    let totalTravelMinutes = 0;
    for (let i = 0; i < hydratedStops.length; i++) {
      const stop = hydratedStops[i];
      totalCost += stop.experience?.priceAmount || 0;
      if (i > 0) {
        const prev = hydratedStops[i - 1].experience!;
        const curr = stop.experience!;
        const dist = haversineDistance(
          prev.latitude,
          prev.longitude,
          curr.latitude,
          curr.longitude
        );
        totalTravelMinutes += Math.max(10, Math.round(dist * 2.5));
      }
    }

    return {
      id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: parsed.title || `${request.city} Custom Adventure`,
      summary:
        parsed.summary ||
        `A balanced journey through ${hydratedStops.length} stops in ${request.city}.`,
      city: request.city,
      stops: hydratedStops,
      estimatedCost: totalCost,
      estimatedTravelMinutes: totalTravelMinutes,
      createdAt: new Date().toISOString(),
      requestParams: request,
    };
  }

  /**
   * Deterministic Plan Generator:
   * Greedily picks top candidates fitting within time & budget constraints.
   */
  public generateDeterministicPlan(
    candidates: ScoredCandidate[],
    request: AIPlanRequest,
    modifier?: string
  ): GeneratedPlan {
    let remainingMinutes = request.availableMinutes;
    let currentCost = 0;
    const selectedCandidates: ScoredCandidate[] = [];

    // Target stop count based on available time
    let maxStops = 2;
    if (request.availableMinutes >= 360) maxStops = 4;
    else if (request.availableMinutes >= 180) maxStops = 3;

    if (modifier === 'more_relaxed') {
      maxStops = Math.max(1, maxStops - 1);
    }

    for (const candidate of candidates) {
      if (selectedCandidates.length >= maxStops) break;

      const exp = candidate.experience;
      const travelEstimate = selectedCandidates.length > 0 ? 20 : 10;
      const totalRequired = exp.durationMinutes + travelEstimate;

      if (totalRequired <= remainingMinutes || selectedCandidates.length === 0) {
        selectedCandidates.push(candidate);
        remainingMinutes -= totalRequired;
        currentCost += exp.priceAmount;
      }
    }

    // Build timeline starting at 09:30 or 10:00
    let currentHour = 10;
    let currentMin = 0;
    const stops: AIPlanStop[] = [];
    let totalTravelMinutes = 0;

    for (let i = 0; i < selectedCandidates.length; i++) {
      const c = selectedCandidates[i];
      const exp = c.experience;

      const timeString = `${String(currentHour).padStart(2, '0')}:${String(
        currentMin
      ).padStart(2, '0')}`;

      // Generate a personalized narrative reason
      let reason = `Top-rated ${exp.category.toLowerCase()} (${exp.rating}★) located ${c.distanceKm}km away.`;
      if (request.interests.length > 0) {
        reason = `Selected for ${exp.category} matching your interest in ${request.interests[0]}.`;
      }
      if (exp.priceTier === 'Free') {
        reason += ' Free admission.';
      }

      stops.push({
        experienceId: exp.id,
        startTime: timeString,
        durationMinutes: exp.durationMinutes,
        reason,
        experience: exp,
      });

      // Advance time by duration + travel
      let travelMins = 15;
      if (i < selectedCandidates.length - 1) {
        const next = selectedCandidates[i + 1].experience;
        const dist = haversineDistance(
          exp.latitude,
          exp.longitude,
          next.latitude,
          next.longitude
        );
        travelMins = Math.max(10, Math.round(dist * 2.5));
      }
      totalTravelMinutes += travelMins;

      const advanceMins = exp.durationMinutes + travelMins;
      const totalMinutesFromStart = currentHour * 60 + currentMin + advanceMins;
      currentHour = Math.floor(totalMinutesFromStart / 60);
      currentMin = totalMinutesFromStart % 60;
    }

    const titlePrefix = modifier
      ? `${modifier.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}: `
      : '';

    return {
      id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: `${titlePrefix}The Best of ${request.city} in ${(
        request.availableMinutes / 60
      ).toFixed(0)}h`,
      summary: `A carefully paced itinerary featuring ${stops.length} top experiences across ${request.city}, optimized for minimal travel time and high quality.`,
      city: request.city,
      stops,
      estimatedCost: currentCost,
      estimatedTravelMinutes: totalTravelMinutes,
      createdAt: new Date().toISOString(),
      requestParams: request,
    };
  }

  private async persistPlan(plan: GeneratedPlan): Promise<void> {
    memoryStore.generatedPlans.set(plan.id, plan);

    try {
      if (process.env.DATABASE_URL) {
        await prisma.generatedPlan.upsert({
          where: { id: plan.id },
          create: {
            id: plan.id,
            title: plan.title,
            summary: plan.summary,
            city: plan.city,
            planJson: JSON.stringify(plan),
            estimatedCost: plan.estimatedCost,
            estimatedTravelMinutes: plan.estimatedTravelMinutes,
            createdAt: new Date(plan.createdAt),
          },
          update: {
            title: plan.title,
            summary: plan.summary,
            planJson: JSON.stringify(plan),
            estimatedCost: plan.estimatedCost,
            estimatedTravelMinutes: plan.estimatedTravelMinutes,
          },
        });
      }
    } catch {
      // Prisma offline or schema differences - memoryStore already updated
    }
  }
}

export const geminiPlannerService = new GeminiPlannerService();
