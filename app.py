import os
import json
import httpx
import base64
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from openai import OpenAI
from dotenv import load_dotenv

# Load local environment variables from .env file
load_dotenv()

app = FastAPI(
    title="SyntheGuard Genome Scanner API",
    description="Microservice to scan genetic sequences for antibiotic resistance genes mecA and NDM-1, using OpenAI, Tavily, and ElevenLabs.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SequenceRequest(BaseModel):
    sequence: str

async def check_resistance_with_openai(sequence: str, api_key: str) -> dict:
    """
    Sends the DNA sequence to OpenAI to analyze for resistance markers mecA and NDM-1.
    """
    client = OpenAI(api_key=api_key)
    
    prompt = f"""
    Analyze the following raw genetic sequence for the presence of mecA or NDM-1 resistance markers or mutations.
    
    Sequence:
    {sequence}
    
    Respond in JSON format with the following keys:
    - "detected": boolean (true if mecA, NDM-1, or significant mutations are present)
    - "marker": string or null ("mecA", "NDM-1", or null)
    - "confidence": float (0.0 to 1.0 representation of detection confidence)
    - "needs_verification": boolean (true if a potential mutation needs live web verification)
    - "summary": string (a concise, clear diagnostic summary explaining the findings and risk level)
    - "detected_mutations": array of objects (each representing a mutation with keys "gene", "mutation_name", and "clinical_significance")
    - "drug_matrix": object (mapping antibiotic names like "Methicillin", "Penicillin", "Carbapenems", etc. to clinical status like "Resistant", "Susceptible", or "Intermediate")
    """
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a professional biosecurity AI assistant. Inspect the sequences carefully and provide accurate JSON diagnostics."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        content = response.choices[0].message.content
        return json.loads(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI diagnostic analysis failed: {str(e)}")

async def search_tavily(query: str, api_key: str) -> str:
    """
    Performs real-time search on Tavily API to verify mutations.
    """
    url = "https://api.tavily.com/search"
    payload = {
        "api_key": api_key,
        "query": query,
        "search_depth": "basic",
        "include_answer": True
    }
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, json=payload, timeout=10.0)
            response.raise_for_status()
            data = response.json()
            return data.get("answer") or "No definitive verification answer was provided by Tavily."
        except Exception as e:
            return f"Verification lookup failed: {str(e)}"

async def generate_speech_elevenlabs(text: str, api_key: str, voice_id: str = "21m00Tcm4TlvDq8ikWAM") -> bytes:
    """
    Sends the diagnostic text to ElevenLabs TTS API and returns the audio bytes.
    """
    truncated_text = text[:300]
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json"
    }
    payload = {
        "text": truncated_text,
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75
        }
    }
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, json=payload, headers=headers, timeout=20.0)
            if response.status_code >= 400:
                print(f"ElevenLabs API Failure Response: {response.text}")
            response.raise_for_status()
            return response.content
        except httpx.HTTPStatusError as e:
            try:
                err_detail = e.response.json()
            except Exception:
                err_detail = e.response.text
            raise HTTPException(status_code=500, detail=f"ElevenLabs speech synthesis failed: {err_detail}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"ElevenLabs speech synthesis failed: {str(e)}")

@app.post("/scan")
@app.post("/api/scan")
async def scan_sequence(
    request: SequenceRequest,
    openai_key: Optional[str] = Header(None, alias="X-OpenAI-Key"),
    tavily_key: Optional[str] = Header(None, alias="X-Tavily-Key"),
    elevenlabs_key: Optional[str] = Header(None, alias="X-ElevenLabs-Key")
):
    # Resolve API keys from headers or fallback to system environment variables
    o_key = openai_key or os.getenv("OPENAI_API_KEY")
    t_key = tavily_key or os.getenv("TAVILY_API_KEY")
    e_key = elevenlabs_key or os.getenv("ELEVENLABS_API_KEY")
    
    if not o_key:
        raise HTTPException(
            status_code=400, 
            detail="Missing OpenAI API key. Provide via 'X-OpenAI-Key' header or set the 'OPENAI_API_KEY' environment variable."
        )
    if not e_key:
        raise HTTPException(
            status_code=400, 
            detail="Missing ElevenLabs API key. Provide via 'X-ElevenLabs-Key' header or set the 'ELEVENLABS_API_KEY' environment variable."
        )

    # 1. Sequence scan with OpenAI
    analysis = await check_resistance_with_openai(request.sequence, o_key)
    
    # 2. Live verification fallback using Tavily if needed
    if analysis.get("needs_verification"):
        if not t_key:
            analysis["summary"] += " [Verification pending: Tavily API key was not provided.]"
        else:
            marker = analysis.get("marker") or "mecA/NDM-1 resistance"
            query = f"antibiotic resistance mutation verification for {marker} genetic sequence"
            verification_ans = await search_tavily(query, t_key)
            analysis["summary"] += f" Verification details: {verification_ans}"
            analysis["verification_details"] = verification_ans

    # 3. ElevenLabs speech synthesis of the final diagnostic summary
    summary_text = analysis.get("summary", "Diagnosis completed, but no summary was provided.")
    audio_content = await generate_speech_elevenlabs(summary_text, e_key)

    # 4. Base64-encode the raw audio bytes
    encoded_audio = base64.b64encode(audio_content).decode('utf-8')

    # Return standard JSON response
    return {
        "detected": analysis.get("detected", False),
        "marker": analysis.get("marker"),
        "confidence": analysis.get("confidence", 0.0),
        "summary": summary_text,
        "detected_mutations": analysis.get("detected_mutations", []),
        "drug_matrix": analysis.get("drug_matrix", {}),
        "audio_payload": f"data:audio/mpeg;base64,{encoded_audio}"
    }
