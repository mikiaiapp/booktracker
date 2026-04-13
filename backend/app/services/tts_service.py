"""
Text-to-Speech service for podcast generation.
Uses OpenAI TTS (tts-1 model) as default - most cost-effective.
Generates two-voice dialogue: different voices for ANA and CARLOS.
"""
import os
import re
import asyncio
import tempfile
from typing import List, Tuple
from app.core.config import settings


async def synthesize_podcast(script: str, output_path: str, api_keys: dict = None):
    """Parse script and generate multi-voice audio."""
    lines = parse_script(script)
    if not lines:
        raise ValueError("Empty or unparseable podcast script")

    # Obtener llave de OpenAI para TTS
    openai_key = api_keys.get("openai") if api_keys else None
    if not openai_key:
        raise ValueError("Se requiere una API Key de OpenAI para generar el audio del podcast.")

    # Por ahora usamos siempre OpenAI como proveedor por defecto (más económico)
    await synthesize_openai(lines, output_path, openai_key)


def parse_script(script: str) -> List[Tuple[str, str]]:
    """Parse 'SPEAKER: text' lines into (speaker, text) tuples."""
    lines = []
    for line in script.split("\n"):
        line = line.strip()
        if not line:
            continue
        match = re.match(r"^(ANA|CARLOS|HOST1|HOST2|SPEAKER1|SPEAKER2)[:\s]+(.+)", line, re.IGNORECASE)
        if match:
            speaker = match.group(1).upper()
            text = match.group(2).strip()
            if text:
                lines.append((speaker, text))
    return lines


async def synthesize_openai(lines: List[Tuple[str, str]], output_path: str, api_key: str):
    """Use OpenAI TTS API with tts-1 (cheapest model)."""
    from openai import AsyncOpenAI
    import struct

    client = AsyncOpenAI(api_key=api_key)

    # Voice mapping: ANA = shimmer (female), CARLOS = echo (male)
    voice_map = {
        "ANA": "shimmer",
        "HOST1": "shimmer",
        "SPEAKER1": "shimmer",
    }

    audio_chunks = []
    for speaker, text in lines:
        voice = voice_map.get(speaker, "echo")
        try:
            response = await client.audio.speech.create(
                model="tts-1",  # cheapest, good quality
                voice=voice,
                input=text,
                response_format="mp3",
            )
            audio_chunks.append(response.content)
        except Exception as e:
            print(f"TTS error for '{speaker}': {e}")
            continue

    # Concatenate MP3 chunks
    with open(output_path, "wb") as f:
        for chunk in audio_chunks:
            f.write(chunk)


async def synthesize_elevenlabs(lines: List[Tuple[str, str]], output_path: str):
    """Use ElevenLabs API - higher quality, higher cost."""
    import httpx

    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        raise ValueError("ELEVENLABS_API_KEY not set")

    # Default free voices
    voice_map = {
        "ANA": "EXAVITQu4vr4xnSDxMaL",       # Bella
        "CARLOS": "VR6AewLTigWG4xSOukaG",      # Arnold
    }

    audio_chunks = []
    async with httpx.AsyncClient(timeout=30) as client:
        for speaker, text in lines:
            voice_id = voice_map.get(speaker, voice_map["CARLOS"])
            r = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json={
                    "text": text,
                    "model_id": "eleven_multilingual_v2",
                    "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
                },
            )
            if r.status_code == 200:
                audio_chunks.append(r.content)

    with open(output_path, "wb") as f:
        for chunk in audio_chunks:
            f.write(chunk)
