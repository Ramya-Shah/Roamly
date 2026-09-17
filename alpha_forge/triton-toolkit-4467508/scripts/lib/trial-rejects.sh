#!/bin/bash
# Helpers for worker-authored trial reject artifacts.

trial_reject_file() {
    echo "$1/.user-reject.md"
}

trial_reject_excludes_substantive() {
    local trial_dir="$1"
    local reject_file value
    reject_file="$(trial_reject_file "$trial_dir")"

    [ -f "$reject_file" ] || return 1

    value="$(
        awk -F: '
            tolower($1) ~ /^[[:space:]]*exclude_from_substantive[[:space:]]*$/ {
                v=$2
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
                print tolower(v)
                exit
            }
        ' "$reject_file"
    )"

    # Missing/unknown field defaults to exclusion for artifacts created by
    # older scripts or manual notes with the conventional filename.
    [ "$value" = "false" ] && return 1
    return 0
}
