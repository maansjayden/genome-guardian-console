# Genome Firewall

An AI-integrated clinical diagnostic dashboard that ingests raw genomic sequence data (`.fasta`), identifies critical antibiotic resistance markers, and outputs a visual EUCAST v14.0 drug susceptibility matrix alongside an AI-synthesized clinical audio brief. 

Built as a solo developer for the **Hack Nation 6th Hackathon**.

---

## Project Breakdown

Genome Firewall bridges the gap between molecular biology and immediate clinical decision-making. The system functions through a unified biosecurity pipeline:
1. **Ingest Zone**: Ingests raw `.fasta` sequence strings via drag-and-drop or upload.
2. **Genomic Analysis Engine**: Inspects sequences for key antimicrobial resistance genes (primarily `mecA` and `NDM-1`).
3. **Real-time Verification Fallback**: Leverages live web search to cross-reference novel mutations against emerging medical literature.
4. **EUCAST v14.0 Mapping**: Outputs a visual drug susceptibility matrix indicating whether the host is Susceptible, Resistant, or Intermediate to standard drug treatments.
5. **Audio Briefing Synthesis**: Generates an executable voice briefing providing an immediate spoken diagnosis for physicians on triage lines.

---

## The Motivation

Raw bioinformatics output is slow, text-heavy, and difficult to parse in a fast-paced emergency or intensive care environment. When a patient presents with a suspected multi-drug resistant infection, clinicians cannot wait hours to manually run BLAST alignments or decode mutation references. Genome Firewall was designed to automate this translation layer—turning raw base pairs into an actionable clinical warning and a spoken diagnostic brief in under five seconds.

---

## The Prompt (Hack Nation Challenge 6)

This project was built specifically to solve **Challenge 6 of the Hack Nation 6th Hackathon**. 

The goal of this genomics track challenge was to create an **Automated Clinical Alert Assistant** capable of:
* Consuming raw sequence data.
* Intercepting biosecurity and antimicrobial resistance risks automatically.
* Formatting immediate visual alerts and actionable summaries to streamline the clinical triage pipeline.

---

## Technical Hurdles Overcome

### 1. Hybrid LLM + Search Query Chaining
Relying solely on static LLM knowledge runs the risk of missing novel resistance mutations or passing outdated drug susceptibility info. To fix this, I designed a conditional pipeline: the OpenAI parser conducts the initial high-throughput sweep, but if a mutation flags a verification indicator (`needs_verification`), the backend programmatically spins up a Tavily API search. The live query results are then dynamically appended to the context before the final report is compiled.

### 2. CORS Bridge under Strict Web Constraints
Bridging a sandboxed React web client (deployed via Lovable) to a local FastAPI backend required configuring custom Cross-Origin Resource Sharing (CORS) rules. To prevent pre-flight `OPTIONS` handshake rejections, I implemented explicit `CORSMiddleware` configurations in FastAPI to correctly handle custom authorization and API key payload headers (`X-OpenAI-Key`, `X-ElevenLabs-Key`, `X-Tavily-Key`) securely.

### 3. In-Memory Base64 Audio Playback & Browser User Gestures
To solve the classic browser autoplay and context-loss issues when handling audio briefs:
* The backend encodes the raw `audio/mpeg` bytes from ElevenLabs into base64 (`data:audio/mpeg;base64,...`) to avoid complex multipart file responses.
* The frontend converts this payload into an in-memory `Blob` and generates a local object URL (`URL.createObjectURL`).
* To bypass browser autoplay blocks, I refactored the playback trigger to execute synchronously inside the click call stack, preserving the user gesture token and preventing silent failures.

---

## Tech Stack

* **Frontend**: React (Vite, TypeScript, TailwindCSS) deployed via Lovable
* **Backend**: Python / FastAPI microservice
* **AI & Search APIs**:
  * **OpenAI API** (`gpt-4o`) — Sequence analysis and structure extraction
  * **Tavily Search API** — Live mutation verification search fallback
  * **ElevenLabs API** (`eleven_turbo_v2_5`) — High-fidelity text-to-speech audio briefs

---

## Local Setup Instructions

### Backend
1. Navigate to the backend directory:
   ```bash
   cd genome-firewall
   ```
2. Create a virtual environment and install dependencies:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
3. Configure your keys in `.env` (refer to `.env.example`):
   ```env
   OPENAI_API_KEY=your_openai_key
   ELEVENLABS_API_KEY=your_elevenlabs_key
   TAVILY_API_KEY=your_tavily_key
   ```
4. Start the dev server:
   ```bash
   uvicorn app:app --reload
   ```

### Frontend
1. Navigate to the frontend directory:
   ```bash
   cd genome-guardian-console
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development environment:
   ```bash
   npm run dev
   ```
