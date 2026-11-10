#medicate
"""Grand Rounds — LiveKit voice agent (Patient persona, real-time).

Runs as a separate process from the FastAPI server. Joins every LiveKit
room created by the frontend and roleplays the patient over WebRTC:

    Browser mic → Deepgram Nova-3 STT → Claude Haiku 4.5 → ElevenLabs TTS → Browser

The persona prompt, speaker gender and speaker age come from room metadata
(set by the backend `/voice/token` endpoint when the room is created). The
ElevenLabs voice for each persona lives in `backend/voices.json`.

Run (WSL; -P keeps the script dir off sys.path so imports stay fast on /mnt/c):
    backend/.venv-voice/bin/python -P backend/voice_agent.py dev
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import Agent, AgentSession, RoomInputOptions, WorkerOptions, cli
from livekit.plugins import anthropic, deepgram, elevenlabs, silero

# Load .env.local first (project convention), .env as fallback.
_BACKEND = Path(__file__).resolve().parent
load_dotenv(_BACKEND / ".env.local")
load_dotenv(_BACKEND / ".env")

logger = logging.getLogger("medkit.voice-agent")
logger.setLevel(logging.INFO)


# ElevenLabs voices per patient persona — see backend/voices.json.
VOICE_CONFIG = json.loads((_BACKEND / "voices.json").read_text(encoding="utf-8"))
DEFAULT_VOICE: str = VOICE_CONFIG["default"]
TTS_MODEL: str = VOICE_CONFIG.get("model", "eleven_flash_v2_5")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY") or os.environ.get("ELEVEN_API_KEY", "")

DEFAULT_INSTRUCTIONS = (
    "You are a patient speaking to a doctor. Keep replies to 1-2 short spoken "
    "sentences. Output spoken dialogue only — no stage directions, no asterisks."
)
DEFAULT_INITIAL = "Hi doc."


def _hash_str(s: str) -> int:
    """FNV-1a, mirrors src/voice/patientPersona.ts so TS-side and Python-side
    pick the same voice slot for the same case ID if frontend chose to defer."""
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def persona_key(gender: str, age: int | None) -> str:
    """'F_young' / 'M_adult' / ... — the key into voices.json `personas`."""
    bands = VOICE_CONFIG.get("age_bands", {"young": 35, "older": 65})
    if age is None:
        band = "adult"
    elif age < bands["young"]:
        band = "young"
    elif age >= bands["older"]:
        band = "older"
    else:
        band = "adult"
    return f"{(gender or 'M').upper()[:1]}_{band}"


def pick_voice(case_id: str, gender: str, age: int | None) -> str:
    """Per-case override → persona (gender × age band) → default."""
    override = VOICE_CONFIG.get("cases", {}).get(case_id)
    if override:
        return override
    return VOICE_CONFIG.get("personas", {}).get(persona_key(gender, age)) or DEFAULT_VOICE


def parse_metadata(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("room metadata is not valid JSON: %r", raw[:120])
        return {}


async def entrypoint(ctx: agents.JobContext):
    await ctx.connect()

    meta = parse_metadata(ctx.room.metadata)
    case_id = meta.get("caseId") or meta.get("case_id") or "unknown"
    speaker_gender = (meta.get("voiceGender") or meta.get("gender") or "M").upper()
    system_prompt = meta.get("systemPrompt") or DEFAULT_INSTRUCTIONS
    initial_line = meta.get("initialLine") or DEFAULT_INITIAL

    try:
        speaker_age = int(meta["voiceAge"]) if meta.get("voiceAge") is not None else None
    except (TypeError, ValueError):
        speaker_age = None

    voice_id = meta.get("voiceId") or pick_voice(case_id, speaker_gender, speaker_age)

    logger.info(
        "joining room=%s case=%s persona=%s voice=%s",
        ctx.room.name, case_id, persona_key(speaker_gender, speaker_age), voice_id,
    )

    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="en"),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001", temperature=0.8),
        tts=elevenlabs.TTS(voice_id=voice_id, model=TTS_MODEL, api_key=ELEVENLABS_API_KEY),
        vad=silero.VAD.load(),
    )

    agent = Agent(instructions=system_prompt)

    await session.start(
        agent=agent,
        room=ctx.room,
        room_input_options=RoomInputOptions(),
    )

    # Frontend signals end-of-visit by publishing a small JSON payload to
    # the room data channel. We speak ONE short farewell out loud via
    # session.say (direct TTS — no LLM round-trip) so the patient actually
    # says goodbye before the room is torn down. Without this the audio
    # cuts mid-sentence on dispatch.
    FAREWELLS = [
        "Thank you, doctor. Take care.",
        "Okay, thanks doc. Goodbye.",
        "Thanks for your help. Bye.",
        "Alright, take care. Goodbye.",
    ]
    farewell_pick = FAREWELLS[_hash_str(case_id) % len(FAREWELLS)]

    # RPC method invoked by the doctor's browser when they click "Dispatch".
    # Speaks ONE short goodbye via direct TTS so the patient actually says
    # bye out loud before the room is torn down.
    @ctx.room.local_participant.register_rpc_method("farewell")
    async def _on_farewell(data: rtc.RpcInvocationData) -> str:
        logger.info("rpc farewell invoked by %s", data.caller_identity)
        try:
            session.say(farewell_pick)
            logger.info("farewell speaking: %r", farewell_pick)
        except Exception as e:
            logger.exception("session.say failed: %s", e)
            return "error"
        return "ok"

    # Patient blurts their chief complaint as soon as the doctor walks up.
    await session.generate_reply(
        instructions=(
            f'Stay strictly in character. Speak this opening line, naturally, '
            f'as the patient (or accompanying parent for pediatric cases) '
            f'arriving in the room: "{initial_line}". One short sentence only.'
        ),
    )


if __name__ == "__main__":
    # `agent_name="medkit-voice"` opts the worker out of automatic dispatch and
    # into explicit-by-name dispatch. Backend rooms are created with
    # `RoomAgentDispatch(agent_name="medkit-voice")` so this matches.
    cli.run_app(
        WorkerOptions(entrypoint_fnc=entrypoint, agent_name="medkit-voice")
    )
