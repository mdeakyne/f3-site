#!/usr/bin/env python3
"""
Analyze all backblast files to extract and count exercises.
"""
import re
from collections import Counter, defaultdict
from pathlib import Path


BACKBLASTS_DIR = Path(__file__).parent.parent / "content" / "backblasts"

# Section headers that contain exercises
EXERCISE_SECTION_PATTERNS = [
    r"warm[\s\-]?up",
    r"the\s+thang",
    r"^thang$",
    r"^mary$",
    r"^exercises?$",
    r"incinerator",
    r"cool\s*down",
    r"beatdown",
    r"emom",
    r"top\s+gun\s+loop",
    r"final\s+minute",
    r"4[\-\s]3[\-\s]2[\-\s]1\s*block",
    r"^\d+[\-\s]+minute\s+emom",
    r"^block$",
]

# Section headers that end exercise content
NON_EXERCISE_SECTION_PATTERNS = [
    r"^cot$",
    r"^circle\s+of\s+trust",
    r"^announcements?",
    r"^prayer",
    r"^moleskin",
    r"^moleskine",
    r"^naked\s+man",
    r"^count[\-\s]?o[\-\s]?rama",
    r"^coffeeteria",
    r"^example",    # Example: sections in ladder workouts
    r"^repeat\s+circuit",
    r"^instructions?",
    r"^notes?$",
    r"^rules?$",
]

# Canonical names: normalize variants to a single name
CANONICAL_NAMES = {
    # Side straddle hop variants
    "ssh": "side straddle hop",
    "sshs": "side straddle hop",
    "side straddle hops": "side straddle hop",
    "side shuttle hops": "side straddle hop",
    "side shuffle hops": "side straddle hop",
    # Merkin variants
    "merkins": "merkin",
    "mericans": "merkin",
    "merican": "merkin",
    "pushup": "merkin",
    "pushups": "merkin",
    "push up": "merkin",
    "push ups": "merkin",
    "push-up": "merkin",
    "push-ups": "merkin",
    "diamond merkins": "diamond merkin",
    "incline merkins": "incline merkin",
    "inclined merkins": "incline merkin",
    "inclined diamond pushups": "diamond merkin",
    "spiderman push ups": "spiderman merkin",
    "spiderman pushups": "spiderman merkin",
    "superman pushups": "superman merkin",
    "superman push ups": "superman merkin",
    "inchworm pushups": "inchworm merkin",
    "inch worm pushups": "inchworm merkin",
    "inchworm merkins": "inchworm merkin",
    "walk out pushup": "walk-out merkin",
    "walk out pushups": "walk-out merkin",
    # Burpee variants
    "burpees": "burpee",
    "blockees": "burpee",
    "blockee": "burpee",
    # Squat variants
    "squats": "squat",
    "slow squats": "slow squat",
    "goblet squats": "goblet squat",
    "goblin squats": "goblet squat",
    "goblin squat": "goblet squat",
    "air squats": "air squat",
    "air squat": "air squat",
    "heavy squats": "heavy squat",
    "squat jumps": "squat jump",
    "split jacks": "split jack",
    "cossack squats": "cossack squat",
    "deep squats": "deep squat",
    "squat (heavy)": "heavy squat",
    # Lunge variants
    "lunges": "lunge",
    "walking lunges": "walking lunge",
    "lateral lunges": "lateral lunge",
    "reverse lunges": "reverse lunge",
    # Curl variants
    "curls": "curl",
    "bicep curls": "curl",
    "bicep curl": "curl",
    "high curls": "curl",
    "low curls": "curl",
    "full curls": "curl",
    "heavy curls": "curl",
    "heavy curl": "curl",
    # Row variants
    "rows": "row",
    "bent over rows": "bent over row",
    "upright rows": "upright row",
    "heavy row": "row",
    "heavy rows": "row",
    # Press variants
    "overhead press": "overhead press",
    "oh press": "overhead press",
    "o/h press": "overhead press",
    "overhead presses": "overhead press",
    "shoulder press": "shoulder press",
    "shoulder presses": "shoulder press",
    "curl press": "curl press",
    # Sit-up variants
    "sit-ups": "sit-up",
    "situps": "sit-up",
    "sit ups": "sit-up",
    "big boy sit-ups": "big boy sit-up",
    "big boy sit ups": "big boy sit-up",
    "big boys": "big boy sit-up",
    "wwii sit-ups": "wwii sit-up",
    "wwii situps": "wwii sit-up",
    "wwii": "wwii sit-up",
    "ww iii situps": "wwiii sit-up",
    "wwiii": "wwiii sit-up",
    # Flutter kicks
    "flutter kicks": "flutter kick",
    "flutter": "flutter kick",
    "flutters": "flutter kick",
    # Plank variants
    "plank jacks": "plank jack",
    "side plank hip dips": "side plank hip dip",
    "ballet planks": "ballet plank",
    "plank walk-ups": "plank walk-up",
    "plank walk ups": "plank walk-up",
    # Core exercises
    "american hammers": "american hammer",
    "american twists": "american twist",
    "lbcs": "lbc",
    "leg raises": "leg raise",
    "heel to heaven": "heels to heaven",
    "v-ups": "v-up",
    "dead bugs": "dead bug",
    "scissor lifts": "scissor lift",
    "grass pullers": "grass puller",
    "big toe smash": "big toe smash",
    # Cardio/movement
    "sprints": "sprint",
    "broad jumps": "broad jump",
    "power skips": "power skip",
    "bear crawls": "bear crawl",
    "mountain climbers": "mountain climber",
    "high knees": "high knee",
    "jumping jacks": "jumping jack",
    "jumping jack": "jumping jack",
    "motivators": "motivator",
    "indian runs": "indian run",
    "lap": "lap",
    "laps": "lap",
    "mosey": "run",
    # Arm/shoulder exercises
    "arm circles": "arm circle",
    "tricep dips": "tricep dip",
    "dips": "tricep dip",
    "sun gods": "sun god",
    "calf raises": "calf raise",
    "bent knee calf raises": "calf raise",
    "thrusters": "thruster",
    # Deadlift variants
    "deadlifts": "deadlift",
    "dead lifts": "deadlift",
    "dead lift": "deadlift",
    "romanian dead lifts": "romanian deadlift",
    "rdl": "romanian deadlift",
    # Hip/glute exercises
    "hip bridges": "hip bridge",
    "glute bridge march": "glute bridge march",
    "jane fondas": "jane fonda",
    "toe touches": "toe touch",
    "good morning": "good morning",
    "weighted good morning": "good morning",
    # F3-specific
    "imperial walkers": "imperial walker",
    "imperial blockers march": "imperial walker",
    "imperial blockers": "imperial walker",
    "abe vigodas": "abe vigoda",
    "michael phelps": "michael phelps",
    "micheal phelps": "michael phelps",
    "freddy mercury": "freddy mercury",
    "freddie mercury": "freddy mercury",
    "freddie mercuries": "freddy mercury",
    "life alert": "life alert",
    "lie alert": "life alert",
    "lie alerts": "life alert",
    "x-factor": "x-factor",
    "xys": "xy",
    # Block/coupon exercises
    "blockins": "block merkin",
    "blockin": "block merkin",
    "block merkins": "block merkin",
    # Calf raises typo variants
    "cal raises": "calf raise",
    "cal raise": "calf raise",
    # Scissor lift typos
    "scissor lits": "scissor lift",
    "scissor lit": "scissor lift",
    # Smurf jacks
    "smurf jacks": "smurf jack",
    "smur jacks": "smurf jack",
    "smurf jack": "smurf jack",
    # Elf on the shelf typos
    "el on the shel": "elf on the shelf",
    "el on the shelf": "elf on the shelf",
    "elf on the shelf": "elf on the shelf",
    # Walls of jericho typo
    "walls o jericho": "walls of jericho",
    # HR merkins
    "hr merkins": "hand-release merkin",
    "hr merkin": "hand-release merkin",
    "hand release merkins": "hand-release merkin",
    "hand release merkin": "hand-release merkin",
    # Glute bridges
    "glute bridges": "glute bridge",
    # Cherry pickers
    "cherry pickers": "cherry picker",
    # Good mornings
    "good mornings": "good morning",
    "weighted good mornings": "good morning",
    # Dry docks
    "dry docks": "dry dock",
    # Russian
    "russian twists": "russian twist",
    # Special moves
    "wushu bounce": "wushu bounce",
    "threads": "thread",
    "thread": "thread",
    "windmills": "windmill",
    "around the world": "around the world",
    "walls of jericho": "walls of jericho",
    "piano man": "piano man",
    "elf on the shelf": "elf on the shelf",
    "murder bunny": "murder bunny",
    "murder bunnies": "murder bunny",
    "broad jump burpees": "broad jump burpee",
    "x factors": "x-factor",
    # Bird dog
    "bird dogs": "bird dog",
    "bird dog": "bird dog",
    # Piano man (strip trailing dash/dashes from "Piano Man - 10x4c")
    "piano man -": "piano man",
    # Inch worm
    "inch worm": "inchworm",
    "inchworms": "inchworm",
    # Shoulder pretzel
    "shoulder pretzel": "shoulder pretzel",
    # Toe tickler
    "toe ticklers": "toe tickler",
    # Welsh dragon (F3 exercise)
    "welsh dragons": "welsh dragon",
    # Typos
    "lutter kicks": "flutter kick",
    "arm circles orward": "arm circle",
    "arm circles forward": "arm circle",
    "arm circles backward": "arm circle",
    "arm circles (forward)": "arm circle",
    "arm circles (backward)": "arm circle",
    # Cossack typo
    "cosack squats": "cossack squat",
    "cosack squat": "cossack squat",
    # Standing rows
    "standing rows": "standing row",
    # One leg variants
    "one leg squats": "single leg squat",
    "one leg squat": "single leg squat",
    # Jumping lunge
    "jumping lunges": "jumping lunge",
    # Shoulder boulders
    "shoulder boulders": "shoulder boulder",
}

# Terms that should be excluded (noise) — matched as exact/prefix
NOISE_TERMS = {
    "partner", "station", "bank", "set", "round", "rounds", "core", "every",
    "and", "starting at", "repeat", "rest", "then", "next", "each",
    "welcome and disclaimers", "welcome and disclaimers, 5 core principles",
    "stretch oyo", "stretch, oyo", "stretch on your own", "stretching on your own",
    "oyo", "5 core principles", "backblast", "where", "when",
    "count", "fngs", "pax", "q:", "q", "coffeeteria", "ao",
    "lap", "mosey to gazebo", "mosey",
    "hold a plank while waiting for the 6", "blocks at one end",
    "95' of moving exercise", "95' o moving exercise",
    "repeat to time",
    "complete", "complete that", "once completed", "move to next",
    "if you complete them all before time",
    "climb back down",
    "exercise is over a", "q is first rabbit",
    "run to", "second plank", "various", "tabata", "tabata:",
    "press",  # too generic - not a standalone exercise name
}


def strip_emojis(text: str) -> str:
    """Remove emoji characters from text."""
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"
        "\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F9FF"
        "\U00002600-\U000027BF"
        "\U0001FA00-\U0001FA9F"
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "\u27a1\u2764\u2b05\u2b06\u2b07\u2b50\u2b55"
        "\u231a\u231b\u23e9-\u23f3\u23f8-\u23fa"
        "\u25aa\u25ab\u25b6\u25c0\u25fb-\u25fe"
        "\u2614\u2615\u2648-\u2653\u267f\u2693\u26a1"
        "\u26aa\u26ab\u26bd\u26be\u26c4\u26c5\u26ce"
        "\u26d4\u26ea\u26f2\u26f3\u26f5\u26fa\u26fd"
        "\u2702\u2705\u2708-\u270d\u270f"
        "\u2712\u2714\u2716\u271d\u2721\u2728"
        "\u2733\u2734\u2744\u2747\u274c\u274e"
        "\u2753-\u2755\u2757\u2763\u2764"
        "\u2795-\u2797\u27a1\u27b0\u27bf"
        "\u2934\u2935\u2b05-\u2b07\u2b1b\u2b1c"
        "\u2b50\u2b55\u3030\u303d\u3297\u3299"
        "\ufe0f"    # variation selector
        "➡️⬅️⬆️⬇️💪🧎🤸🦴☕⛔"
        "]+",
        flags=re.UNICODE
    )
    result = emoji_pattern.sub('', text)
    # Also strip slack-style :emoji: codes
    result = re.sub(r':[a-z_\-]+(?::skin-tone-\d)?:', '', result)
    return result.strip()


def is_section_header(line: str) -> tuple[bool, bool]:
    """Returns (is_exercise_section, is_non_exercise_section)."""
    clean = line.strip().lower()
    # Remove markdown bold, colons, bullets
    clean = re.sub(r'\*+', '', clean)
    clean = re.sub(r'[-–•]+', '', clean)
    clean = re.sub(r':+$', '', clean).strip()

    for pattern in NON_EXERCISE_SECTION_PATTERNS:
        if re.search(pattern, clean):
            return False, True

    for pattern in EXERCISE_SECTION_PATTERNS:
        if re.search(pattern, clean):
            return True, False

    return False, False


def clean_exercise_text(text: str) -> str:
    """Strip noise to get just the exercise name."""
    result = strip_emojis(text)

    # Strip bullet/list markers
    result = re.sub(r"^[\s\-*•➡️💪🧎]+", "", result)
    result = re.sub(r"^\d+\.\s+", "", result)  # "1. Exercise"
    result = re.sub(r"^\d+\s*[-–]\s*", "", result)  # "1 - Exercise", "1– Exercise"

    # Strip markdown formatting
    result = re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", result)
    result = re.sub(r"\*+", "", result)

    # Strip EMOM-style prefixes
    result = re.sub(r"^minute\s+\d+\s*[–\-:]\s*", "", result, flags=re.IGNORECASE)
    result = re.sub(r"^\d+\s+min\s*[–\-:]\s*", "", result, flags=re.IGNORECASE)

    # Strip markdown links
    result = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", result)

    # Strip @mentions
    result = re.sub(r"@\w+", "", result)

    # Remove leading rep counts: "20 goblet squat" -> "goblet squat"
    result = re.sub(r"^\d+\s+", "", result)

    # Remove trailing rep/time info
    result = re.sub(r"\s+\d+.*$", "", result)       # "squat 20 reps"
    result = re.sub(r"\s*\(4\s*cnt\)\s*$", "", result, flags=re.IGNORECASE)
    result = re.sub(r"\s*\(4\s*count\)\s*$", "", result, flags=re.IGNORECASE)
    result = re.sub(r"\s*x\d+\s*$", "", result, flags=re.IGNORECASE)
    result = re.sub(r"\s*\(x\d+\)\s*$", "", result, flags=re.IGNORECASE)

    # Remove trailing filler/directional phrases
    filler_suffixes = [
        r"\s*&.*$",            # " & 1 burpee" compound combos — strip after &
        r",?\s+jog\s+back.*$",
        r",?\s+to\s+halfway.*$",
        r",?\s+up\s+and\s+back.*$",
        r",?\s+each\s+side.*$",
        r",?\s+each\s+leg.*$",
        r",?\s+knee\s+to\s+ground.*$",
        r",?\s+forward/reverse.*$",
        r",?\s+outbound.*$",
        r",?\s+slow\s+negatives.*$",
        r",?\s+rest\s+remainder.*$",
        r"\s*[-–]\s*rest\s+remainder.*$",
        r"\s*\(.*?\)\s*$",  # trailing parentheticals
        r",?\s+with\s+coupon.*$",
        r",?\s+to\s+failure.*$",
    ]
    for filler in filler_suffixes:
        result = re.sub(filler, "", result, flags=re.IGNORECASE)

    return result.strip()


def is_noise(text: str) -> bool:
    """Return True if this text is clearly not an exercise name."""
    lower = text.lower().strip()

    # Exact match against noise terms
    if lower in NOISE_TERMS:
        return True

    # Check if it starts with a noise term
    for term in NOISE_TERMS:
        if lower.startswith(term + " ") or lower.startswith(term + ","):
            return True

    # Too short or too long
    if len(text) < 3 or len(text) > 70:
        return True

    # Mostly non-alpha
    alpha_ratio = sum(c.isalpha() or c == ' ' for c in text) / len(text)
    if alpha_ratio < 0.5:
        return True

    # Looks like a sentence (contains period or multiple commas)
    if text.count('.') > 1:
        return True
    if text.count(',') > 2:
        return True

    # Long prose sentences
    words = text.split()
    if len(words) > 7:
        return True

    # Lines that are clearly structural descriptions
    structural = [
        r"^sprint\s+out\s+rung",
        r"^sprint\s+out\s+run\s+",
        r"^run\s+to\s+\d",
        r"^jog\s+to\s+\d",
        r"^\d+\s+rungs?$",
        r"^each\s+exercise",
        r"^complete\s+",
        r"^once\s+(rabbit|completed)",
        r"^if\s+you",
        r"^move\s+to\s+next",
        r"^repeat\s+with",
        r"^climb\s+back",
        r"^song\s+change",
        r"^q\s+is",
        r"^picks\s+next",
        r"^can'?t\s+pick",
        r"^pax\s+start",
        r"^hold\s+a\s+plank\s+while",
        r"^blocks\s+at\s+one",
        r"^repeat\s+to\s+time",
        r"^welcome\s+and\s+disclaimer",
        r"^each\s+minute:?$",
        r"^alternate\s+each\s+minute",
        r"^\(?\d+\s+yard(s)?\)?$",
        r"^superset$",
        r"^station\s+\d+",
        r"^\d+\s+sets?$",
        r"^\d+-\d+-\d+\s+yard",   # "1-15-2 yard shuttle runs"
        r"^5-10-15",               # shuttle run descriptions
        r"^\d+[\-\s]+\d+[\-\s]+\d+\s+yard",
        r"^round\s+\d+",
        r"^second\s+side\s+plank",
    ]
    for pattern in structural:
        if re.search(pattern, lower):
            return True

    return False


def is_likely_exercise(text: str) -> bool:
    if is_noise(text):
        return False
    # Must have at least one alphabetic word
    if not re.search(r'[a-zA-Z]{2,}', text):
        return False
    return True


def extract_exercises_from_body(body: str) -> list[str]:
    """Extract exercise names from the markdown body text."""
    exercises = []
    lines = body.split('\n')
    in_exercise_section = False

    for line in lines:
        stripped = strip_emojis(line.strip())
        if not stripped:
            continue

        # Detect section headers
        # A line is a header candidate if it's short and matches known patterns
        lower = stripped.lower()
        lower_clean = re.sub(r'\*+|:+$', '', lower).strip()

        # Check non-exercise sections first
        is_ex, is_non_ex = is_section_header(stripped)
        if is_non_ex:
            in_exercise_section = False
            continue
        if is_ex:
            in_exercise_section = True
            continue

        if not in_exercise_section:
            continue

        # We're in an exercise section - check if this line has an exercise

        # Format 1: Bullet point lines (- exercise, * exercise, • exercise)
        is_bullet = bool(re.match(r'^\s*[-*•]\s+', line.strip()))

        # Format 2: Numbered list (1. exercise)
        is_numbered = bool(re.match(r'^\s*\d+\.\s+', stripped))

        # Format 3: EMOM minute lines (Minute 1 – exercise)
        is_emom_line = bool(re.match(r'^\s*minute\s+\d+', stripped, re.IGNORECASE))

        # Format 4: Plain exercise name on its own line (emoji-prefixed or plain)
        # These appear in "bent-out-of-shape" style workouts
        # Accept if: no complex sentence structure, short, looks like an exercise
        has_original_emoji = bool(re.search(r'[➡️💪🧎🤸⬆️⬇️]|:[a-z_]+:', line))
        is_plain_exercise = (
            not is_bullet and not is_numbered and not is_emom_line and
            (has_original_emoji or (
                len(stripped.split()) <= 5 and
                not re.search(r'[.!?]', stripped) and
                not re.match(r'^(where|when|q:|pax|backblast|ao|count|date|fng)', lower)
            ))
        )

        if is_bullet or is_numbered or is_emom_line or is_plain_exercise:
            exercise = clean_exercise_text(stripped)
            if is_likely_exercise(exercise):
                exercises.append(exercise.lower())

    return exercises


def normalize_exercise(exercise: str) -> str:
    """Apply canonical name mapping."""
    # Try exact match
    if exercise in CANONICAL_NAMES:
        return CANONICAL_NAMES[exercise]

    # Try stripping trailing 's'
    if exercise.endswith('s') and exercise[:-1] in CANONICAL_NAMES:
        return CANONICAL_NAMES[exercise[:-1]]

    return exercise


def parse_backblast(filepath: Path) -> list[str]:
    """Parse a single backblast file and return list of exercises."""
    content = filepath.read_text(encoding='utf-8', errors='replace')

    # Split off YAML frontmatter
    if content.startswith('---'):
        parts = content.split('---', 2)
        body = parts[2] if len(parts) >= 3 else content
    else:
        body = content

    raw = extract_exercises_from_body(body)
    return [normalize_exercise(e) for e in raw]


def main():
    all_exercises = []
    files_processed = 0
    files_with_exercises = 0

    backblast_files = sorted(BACKBLASTS_DIR.glob("*.md"))
    print(f"Processing {len(backblast_files)} backblast files...\n")

    for filepath in backblast_files:
        exercises = parse_backblast(filepath)
        files_processed += 1
        if exercises:
            files_with_exercises += 1
            all_exercises.extend(exercises)

    counter = Counter(all_exercises)

    print(f"Files processed:           {files_processed}")
    print(f"Files with exercises found:{files_with_exercises}")
    print(f"Total exercise instances:  {len(all_exercises)}")
    print(f"Unique exercises:          {len(counter)}\n")

    print("=" * 60)
    print("TOP EXERCISES BY COUNT")
    print("=" * 60)
    for exercise, count in counter.most_common(80):
        bar = "#" * min(count, 50)
        print(f"{count:4d}  {bar}  {exercise}")

    output_path = Path(__file__).parent.parent / "exercise-analysis.md"
    write_report(counter, files_processed, files_with_exercises, len(all_exercises), output_path)
    print(f"\nFull report written to: {output_path}")

    return counter


def write_report(counter: Counter, files_processed: int, files_with_exercises: int,
                 total_instances: int, output_path: Path):
    lines = [
        "# Backblast Exercise Analysis",
        "",
        f"Analyzed **{files_processed}** backblast files.",
        f"- Files with parsed exercises: **{files_with_exercises}**",
        f"- Total exercise instances: **{total_instances}**",
        f"- Unique exercises identified: **{len(counter)}**",
        "",
        "---",
        "",
        "## Exercise Rankings",
        "",
        "| Rank | Exercise | Times Done |",
        "| ---- | -------- | ---------- |",
    ]

    for rank, (exercise, count) in enumerate(counter.most_common(), start=1):
        lines.append(f"| {rank} | {exercise.title()} | {count} |")

    lines.extend([
        "",
        "---",
        "",
        "_Generated by `scripts/analyze_exercises.py`_",
    ])

    output_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')


if __name__ == "__main__":
    main()
