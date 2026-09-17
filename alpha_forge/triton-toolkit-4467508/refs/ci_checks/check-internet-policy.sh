#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

section_value() {
    local file="$1"
    local section="$2"
    local key="$3"

    awk -v section="$section" -v key="$key" '
        function trim(s) {
            gsub(/^[ \t\r\n]+|[ \t\r\n,]+$/, "", s)
            gsub(/^(["\047])+|(["\047])+$/, "", s)
            return s
        }
        /^[[:space:]]*\[/ {
            header = $0
            sub(/[[:space:]]*#.*/, "", header)
            sub(/^[[:space:]]*\[/, "", header)
            sub(/\].*$/, "", header)
            gsub(/[[:space:]]/, "", header)
            in_section = (header == section)
            next
        }
        in_section {
            line = $0
            sub(/[[:space:]]*#.*/, "", line)
            if (line ~ "^[[:space:]]*" key "[[:space:]]*=") {
                sub(/^[^=]*=/, "", line)
                print trim(line)
                exit
            }
        }
    ' "$file"
}

has_section() {
    local file="$1"
    local section="$2"

    awk -v section="$section" '
        /^[[:space:]]*\[/ {
            header = $0
            sub(/[[:space:]]*#.*/, "", header)
            sub(/^[[:space:]]*\[/, "", header)
            sub(/\].*$/, "", header)
            gsub(/[[:space:]]/, "", header)
            if (header == section) {
                found = 1
                exit
            }
        }
        END { exit found ? 0 : 1 }
    ' "$file"
}

test_sh_has_runtime_network_installs() {
    local test_sh="$1"

    grep -Eiv '^[[:space:]]*(#|$)' "$test_sh" | grep -Eiq \
        '(^|[;&|[:space:]])(apt-get|apt|apk|yum|dnf)[[:space:]]+(update|install|add)|(^|[;&|[:space:]])(curl|wget)[[:space:]]|(^|[;&|[:space:]])uvx([[:space:]]|$)|(^|[;&|[:space:]])uv[[:space:]]+pip[[:space:]]+install|(^|[;&|[:space:]])pip[0-9.]*[[:space:]]+install|python[0-9.]*[[:space:]]+-m[[:space:]]+pip[[:space:]]+install|(^|[;&|[:space:]])(npm|pnpm|yarn)[[:space:]]+(install|add|i)([[:space:]]|$)'
}

files_to_check=()
if [ $# -eq 0 ]; then
    while IFS= read -r file; do
        files_to_check+=("$file")
    done < <(find tasks -type f -name "task.toml" 2>/dev/null || true)
else
    for task_dir in "$@"; do
        if [ -d "$task_dir" ] && [ -f "$task_dir/task.toml" ]; then
            files_to_check+=("$task_dir/task.toml")
        elif [ -f "$task_dir" ] && [ "$(basename "$task_dir")" = "task.toml" ]; then
            files_to_check+=("$task_dir")
        fi
    done
fi

if [ "${#files_to_check[@]}" -eq 0 ]; then
    echo "No task.toml files to check"
    exit 0
fi

failed=0

for task_toml in "${files_to_check[@]}"; do
    task_dir="$(dirname "$task_toml")"
    echo "Checking internet policy for $task_toml..."

    env_allow="$(section_value "$task_toml" "environment" "allow_internet" || true)"
    verifier_allow="$(section_value "$task_toml" "verifier.environment" "allow_internet" || true)"
    verifier_mode="$(section_value "$task_toml" "verifier" "environment_mode" || true)"
    verifier_image="$(section_value "$task_toml" "verifier.environment" "docker_image" || true)"

    if [ "$env_allow" = "false" ]; then
        echo -e "${RED}ERROR:${NC} [environment] allow_internet = false is not supported for normal toolkit trials."
        echo "  Harbor installs claude-code inside the agent environment; with network disabled, trials can fail before the task is attempted."
        echo "  Mirror TB3 by keeping [environment] allow_internet = true and, only for advanced offline verification, use [verifier] environment_mode = \"separate\" plus [verifier.environment] allow_internet = false."
        failed=1
    fi

    if [ "$verifier_allow" = "false" ]; then
        if [ "$verifier_mode" != "separate" ]; then
            echo -e "${RED}ERROR:${NC} [verifier.environment] allow_internet = false requires [verifier] environment_mode = \"separate\"."
            failed=1
        fi

        if [ "$env_allow" = "false" ]; then
            :
        elif [ "$env_allow" != "true" ]; then
            echo -e "${YELLOW}WARNING:${NC} TB3-style offline verifier tasks should explicitly keep [environment] allow_internet = true so agent setup remains online."
        fi

        if [ ! -f "$task_dir/tests/Dockerfile" ] && [ -z "$verifier_image" ]; then
            echo -e "${RED}ERROR:${NC} offline verifier mode needs a vendored verifier image, usually $task_dir/tests/Dockerfile, or [verifier.environment] docker_image."
            failed=1
        fi

        test_sh="$task_dir/tests/test.sh"
        if [ -f "$test_sh" ] && test_sh_has_runtime_network_installs "$test_sh"; then
            echo -e "${RED}ERROR:${NC} $test_sh performs runtime network/package installs but [verifier.environment] allow_internet = false."
            echo "  Move verifier dependencies into tests/Dockerfile or a prebuilt verifier image, then run pytest directly from tests/test.sh."
            failed=1
        fi
    elif has_section "$task_toml" "verifier.environment"; then
        echo "  OK: separate verifier environment present; verifier networking is not disabled."
    fi
done

if [ "$failed" -eq 1 ]; then
    echo ""
    echo "Internet policy check failed."
    exit 1
fi

echo -e "${GREEN}Internet policy check passed${NC}"
