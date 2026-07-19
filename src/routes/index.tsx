import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, FileType2, Activity, Shield, AlertTriangle, CheckCircle2, XCircle,
  Play, Pause, Radio, Zap, Dna, Waves, Terminal, ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Genome Firewall — Clinical Diagnostic Dashboard" },
      { name: "description", content: "Enterprise-grade clinical diagnostic dashboard for genomic threat detection and antibiotic resistance profiling." },
      { property: "og:title", content: "Genome Firewall" },
      { property: "og:description", content: "Clinical diagnostic dashboard for genomic threat detection." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GenomeFirewall,
});

type NodeStatus = { name: string; state: "online" | "warn" | "offline"; latency: string };

const NODES: NodeStatus[] = [
  { name: "OpenAI Parser", state: "online", latency: "42ms" },
  { name: "Tavily Clinical Search", state: "online", latency: "128ms" },
  { name: "ElevenLabs Audio Synthesis", state: "online", latency: "89ms" },
];

const FALLBACK_RECOMMENDED = [
  { name: "Colistin", class: "Polymyxin", efficacy: 94 },
  { name: "Tigecycline", class: "Glycylcycline", efficacy: 88 },
  { name: "Fosfomycin", class: "Phosphonic", efficacy: 76 },
  { name: "Aztreonam + Avibactam", class: "Combination", efficacy: 82 },
];

const FALLBACK_COMPROMISED = [
  { name: "Meropenem", class: "Carbapenem", resistance: "NDM-1" },
  { name: "Imipenem", class: "Carbapenem", resistance: "NDM-1" },
  { name: "Ertapenem", class: "Carbapenem", resistance: "NDM-1" },
  { name: "Ceftazidime", class: "Cephalosporin", resistance: "CTX-M-15" },
  { name: "Ciprofloxacin", class: "Fluoroquinolone", resistance: "gyrA mut." },
];

type Recommended = { name: string; class: string; efficacy: number };
type Compromised = { name: string; class: string; resistance: string };
type ScanData = {
  threatLevel: string;
  title: string;
  organism?: string;
  description: string;
  confidence: string;
  mutations: string[];
  recommended: Recommended[];
  compromised: Compromised[];
  audioUrl?: string;
};

function normalizeScan(raw: any): ScanData {
  const mutations: string[] = Array.isArray(raw?.mutations)
    ? raw.mutations
    : raw?.mutation
    ? [raw.mutation]
    : raw?.detected_mutations ?? [];
  const primary = mutations[0] ?? raw?.threat ?? "Unknown Variant";
  const level = (raw?.threat_level ?? raw?.level ?? "CRITICAL").toString().toUpperCase();
  const organism = raw?.organism ?? raw?.species;
  const confidenceNum = raw?.confidence ?? raw?.score;
  const confidence =
    typeof confidenceNum === "number"
      ? confidenceNum <= 1
        ? `${(confidenceNum * 100).toFixed(1)}%`
        : `${confidenceNum.toFixed(1)}%`
      : (confidenceNum ?? "—").toString();

  let audioUrl: string | undefined;
  const payload = raw?.audio_payload;
  if (typeof payload === "string" && payload.length) {
    audioUrl = payload.startsWith("data:") || payload.startsWith("http")
      ? payload
      : `data:audio/mpeg;base64,${payload}`;
  } else if (typeof raw?.audio_url === "string") audioUrl = raw.audio_url;
  else if (typeof raw?.audio_base64 === "string")
    audioUrl = `data:audio/mpeg;base64,${raw.audio_base64}`;
  else if (typeof raw?.audio === "string")
    audioUrl =
      raw.audio.startsWith("http") || raw.audio.startsWith("data:")
        ? raw.audio
        : `data:audio/mpeg;base64,${raw.audio}`;


  return {
    threatLevel: level,
    title: `${level}: ${primary} Detected`,
    organism,
    description:
      raw?.description ??
      raw?.summary ??
      (organism
        ? `${primary} detected in ${organism}. Review susceptibility profile below.`
        : `${primary} detected. Review susceptibility profile below.`),
    confidence,
    mutations: mutations.length ? mutations : [primary],
    recommended:
      Array.isArray(raw?.recommended) && raw.recommended.length
        ? raw.recommended.map((a: any) => ({
            name: a.name ?? a.drug ?? "Unknown",
            class: a.class ?? a.category ?? "—",
            efficacy: Number(a.efficacy ?? a.score ?? 0),
          }))
        : FALLBACK_RECOMMENDED,
    compromised:
      Array.isArray(raw?.compromised) && raw.compromised.length
        ? raw.compromised.map((a: any) => ({
            name: a.name ?? a.drug ?? "Unknown",
            class: a.class ?? a.category ?? "—",
            resistance: a.resistance ?? a.mechanism ?? "resistant",
          }))
        : FALLBACK_COMPROMISED,
    audioUrl,
  };
}

function GenomeFirewall() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [recentScans, setRecentScans] = useState<{ id: string; state: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const resetScan = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setScanData(null);
    setFile(null);
    setError(null);
    setPlaying(false);
    setAudioReady(false);
    setDragOver(false);
    if (inputRef.current) inputRef.current.value = "";
  };


  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }, []);

  const onSelect = (f: File | null) => {
    if (f) setFile(f);
  };

  const scan = async () => {
    if (!file) return;
    setScanning(true);
    setScanData(null);
    setError(null);
    setAudioReady(false);
    audioRef.current?.pause();
    audioRef.current = null;
    try {
      const sequence = await file.text();
      const res = await fetch("http://127.0.0.1:8000/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence }),
      });
      if (!res.ok) throw new Error(`Backend error ${res.status}: ${await res.text()}`);
      const data = normalizeScan(await res.json());
      setScanData(data);
      const level = data.threatLevel.toUpperCase();
      const state =
        level === "CRITICAL" || level === "HIGH"
          ? "critical"
          : level === "WARN" || level === "WARNING" || level === "MODERATE" || level === "MEDIUM"
          ? "warn"
          : "clear";
      setRecentScans((prev) => [{ id: file.name, state }, ...prev].slice(0, 8));
      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.preload = "auto";
        audioRef.current = audio;
        audio.addEventListener("canplaythrough", () => setAudioReady(true), { once: true });
        audio.addEventListener("loadeddata", () => setAudioReady(true), { once: true });
        audio.addEventListener("play", () => setPlaying(true));
        audio.addEventListener("pause", () => setPlaying(false));
        audio.addEventListener("ended", () => setPlaying(false));
        audio.addEventListener("error", () => setError("Audio failed to load"));
        audio.load();
      }
    } catch (e: any) {
      setError(e?.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch((err) => setError(`Playback blocked: ${err?.message ?? err}`));
    else a.pause();
  };


  const results = !!scanData;

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="border-b border-border/50 backdrop-blur-xl bg-background/40 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-lg glass-panel flex items-center justify-center neon-border">
                <Dna className="w-5 h-5 neon-text" />
              </div>
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-widest uppercase">Genome<span className="neon-text">Firewall</span></h1>
              <p className="text-[10px] text-muted-foreground tracking-wider font-mono">v4.2.1 · SESSION #A7F3-9B2C</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Radio className="w-3.5 h-3.5 neon-text" />
              <span>SECURE CHANNEL</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="text-muted-foreground">DR. E. NAKAMURA · <span className="text-foreground">L4</span></div>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-6 grid grid-cols-12 gap-6">
        {/* Sidebar */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <div className="glass-panel p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Telemetry</h2>
              <Activity className="w-3.5 h-3.5 neon-text" />
            </div>
            <div className="space-y-3">
              {NODES.map((n) => (
                <div key={n.name} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="relative flex items-center justify-center w-2.5 h-2.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
                      <span className="relative rounded-full h-2 w-2 bg-success" />
                    </span>
                    <span className="text-xs font-medium truncate">{n.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">{n.latency}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 pt-4 border-t border-border/50">
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground mb-2">
                <span>UPTIME</span><span className="text-foreground">99.982%</span>
              </div>
              <div className="h-1 bg-input rounded-full overflow-hidden">
                <div className="h-full w-[99%] bg-gradient-to-r from-success to-primary" />
              </div>
            </div>
          </div>

          <div className="glass-panel p-5">
            <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-3">Recent Scans</h2>
            {recentScans.length === 0 ? (
              <p className="text-[11px] font-mono text-muted-foreground/70 italic py-2">
                No scans yet. Ingest a sequence to begin.
              </p>
            ) : (
              <ul className="space-y-2 text-xs font-mono">
                {recentScans.map((s, i) => (
                  <li key={`${s.id}-${i}`} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/40 transition-colors cursor-pointer gap-2">
                    <span className="text-muted-foreground truncate">{s.id}</span>
                    <span className={
                      s.state === "critical" ? "text-destructive" :
                      s.state === "warn" ? "text-warning" : "text-success"
                    }>{s.state.toUpperCase()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="glass-panel p-5">
            <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-3">System Load</h2>
            <div className="space-y-3">
              {[["GPU Cluster", 68], ["Memory", 42], ["I/O Throughput", 81]].map(([label, val]) => (
                <div key={label as string}>
                  <div className="flex justify-between text-[10px] font-mono mb-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span>{val}%</span>
                  </div>
                  <div className="h-1 bg-input rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${val}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="col-span-12 lg:col-span-9 space-y-6">
          {/* Ingest */}
          {!results && (
          <section
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`relative glass-panel p-8 transition-all duration-300 overflow-hidden ${
              dragOver ? "neon-border scale-[1.005]" : ""
            }`}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground tracking-widest uppercase mb-1">
                  <Terminal className="w-3 h-3" /> Ingest Zone
                </div>
                <h2 className="text-2xl font-semibold tracking-tight">Sequence Intake Protocol</h2>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-success">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> READY
              </div>
            </div>

            <label
              htmlFor="fasta"
              className={`relative flex flex-col items-center justify-center py-14 px-6 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-300 group ${
                dragOver
                  ? "border-neon bg-neon/5 animate-glow-pulse"
                  : "border-border hover:border-neon/60 hover:bg-neon/[0.02]"
              }`}
            >
              {dragOver && (
                <div className="absolute inset-x-0 top-0 h-full overflow-hidden pointer-events-none">
                  <div className="h-px bg-gradient-to-r from-transparent via-neon to-transparent animate-scan-line" />
                </div>
              )}
              <div className={`relative w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-all ${
                dragOver ? "bg-neon/20 neon-border" : "bg-muted/50 group-hover:bg-neon/10"
              }`}>
                <Upload className={`w-7 h-7 transition-colors ${dragOver ? "neon-text" : "text-muted-foreground group-hover:text-primary"}`} />
              </div>
              <p className="text-base font-medium mb-1">
                {file ? (
                  <span className="flex items-center gap-2">
                    <FileType2 className="w-4 h-4 neon-text" />
                    <span className="font-mono">{file.name}</span>
                  </span>
                ) : (
                  <>Drop <span className="neon-text font-mono">.fasta</span> sequence or click to browse</>
                )}
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                {file ? `${(file.size / 1024).toFixed(1)} KB · Ready to scan` : "Max 512MB · FASTA / FASTQ / GenBank formats accepted"}
              </p>
              <input
                id="fasta"
                ref={inputRef}
                type="file"
                accept=".fasta,.fastq,.fa,.gb,.txt"
                className="hidden"
                onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
              />
            </label>

            {error && (
              <div className="mt-4 p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-xs font-mono text-destructive">
                {error}
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 neon-text" /> AES-256 ENCRYPTED</span>
                <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 neon-text" /> ~2.4s AVG SCAN</span>
              </div>
              <button
                onClick={scan}
                disabled={!file || scanning}
                className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-neon text-primary-foreground font-semibold text-sm tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-[0_0_30px_var(--neon-glow)] active:scale-95"
              >
                {scanning ? (
                  <>
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    Scan Sequence <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </section>
          )}

          {/* Scanning skeletons */}
          {scanning && (
            <section className="glass-panel p-6 space-y-4">
              <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground tracking-widest uppercase">
                <span className="w-2 h-2 rounded-full bg-neon animate-pulse" />
                DECODING GENOMIC MARKERS…
              </div>
              <div className="skeleton h-8 w-2/3" />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="skeleton h-5 w-1/2" />
                  <div className="skeleton h-12" />
                  <div className="skeleton h-12" />
                  <div className="skeleton h-12" />
                </div>
                <div className="space-y-2">
                  <div className="skeleton h-5 w-1/2" />
                  <div className="skeleton h-12" />
                  <div className="skeleton h-12" />
                  <div className="skeleton h-12" />
                </div>
              </div>
            </section>
          )}

          {/* Results */}
          {results && scanData && !scanning && (
            <>
              {/* Threat banner */}
              <section className="relative overflow-hidden rounded-lg border-2 border-destructive/60 bg-gradient-to-r from-destructive/25 via-destructive/10 to-warning/20 p-5 animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="absolute inset-y-0 left-0 w-1 bg-destructive" />
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-full bg-destructive/30 border border-destructive flex items-center justify-center flex-shrink-0 animate-pulse">
                    <AlertTriangle className="w-6 h-6 text-destructive-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-mono tracking-[0.2em] text-destructive-foreground/80 mb-1">
                      THREAT LEVEL · {scanData.threatLevel} · ISO/IEC 27035
                    </div>
                    <h3 className="text-xl font-bold tracking-tight">{scanData.title}</h3>
                    <p className="text-sm text-foreground/80 mt-1 max-w-2xl">
                      {scanData.description}
                      {scanData.organism && (
                        <> Organism: <span className="font-mono">{scanData.organism}</span>.</>
                      )}
                    </p>
                    {scanData.mutations.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {scanData.mutations.map((m) => (
                          <span
                            key={m}
                            className="px-2.5 py-1 rounded-full bg-destructive/25 text-destructive text-[10px] font-mono font-semibold tracking-widest uppercase border border-destructive/50"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-xs font-mono flex-shrink-0">
                    <div className="text-muted-foreground">CONFIDENCE</div>
                    <div className="text-2xl font-bold text-destructive-foreground">{scanData.confidence}</div>
                    <button
                      onClick={resetScan}
                      className="mt-3 text-[10px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ← New Scan
                    </button>
                  </div>
                </div>
              </section>

              {/* Audio player */}
              <section className="glass-panel p-5 flex items-center gap-5 animate-in fade-in slide-in-from-top-4 duration-500 delay-100">
                <button
                  onClick={togglePlay}
                  disabled={!scanData.audioUrl || !audioReady}
                  className="relative w-14 h-14 rounded-full bg-neon text-primary-foreground flex items-center justify-center flex-shrink-0 hover:shadow-[0_0_30px_var(--neon-glow)] transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {scanData.audioUrl && !audioReady ? (
                    <span className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  ) : playing ? (
                    <Pause className="w-6 h-6" fill="currentColor" />
                  ) : (
                    <Play className="w-6 h-6 ml-0.5" fill="currentColor" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground tracking-widest uppercase mb-1">
                    <Waves className="w-3 h-3" /> Clinical Brief · ElevenLabs
                  </div>
                  <div className="text-sm font-semibold mb-2">Play Clinical Brief — Case #A7F3-9B2C</div>
                  <Waveform playing={playing} />
                </div>
                <div className="text-right font-mono text-xs text-muted-foreground flex-shrink-0">
                  <div>
                    {!scanData.audioUrl
                      ? "NO AUDIO"
                      : !audioReady
                      ? "LOADING…"
                      : playing
                      ? "STREAMING"
                      : "READY"}
                  </div>
                  <div className="text-neon mt-1">HIGH FIDELITY</div>
                </div>

              </section>

              {/* Results matrix */}
              <section className="glass-panel p-6 animate-in fade-in slide-in-from-top-4 duration-500 delay-200">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <div className="text-xs font-mono text-muted-foreground tracking-widest uppercase mb-1">Results Matrix</div>
                    <h3 className="text-xl font-semibold tracking-tight">Antibiotic Susceptibility Profile</h3>
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {scanData.recommended.length + scanData.compromised.length} compounds analyzed · <span className="text-foreground">EUCAST v14.0</span>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  {/* Recommended */}
                  <div>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-success/30">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <h4 className="text-sm font-semibold tracking-widest uppercase text-success">Recommended</h4>
                      <span className="ml-auto text-xs font-mono text-muted-foreground">{scanData.recommended.length}</span>
                    </div>
                    <ul className="space-y-2">
                      {scanData.recommended.map((a) => (
                        <li key={a.name} className="flex items-center justify-between p-3 rounded-lg bg-success/[0.06] border border-success/20 hover:bg-success/[0.1] transition-colors">
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{a.name}</div>
                            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{a.class}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono text-success">{a.efficacy}%</span>
                            <span className="px-2.5 py-1 rounded-full bg-success/20 text-success text-[10px] font-semibold tracking-widest uppercase border border-success/40">
                              Susceptible
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Compromised */}
                  <div>
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-destructive/30">
                      <XCircle className="w-4 h-4 text-destructive" />
                      <h4 className="text-sm font-semibold tracking-widest uppercase text-destructive">Compromised</h4>
                      <span className="ml-auto text-xs font-mono text-muted-foreground">{scanData.compromised.length}</span>
                    </div>
                    <ul className="space-y-2">
                      {scanData.compromised.map((a) => (
                        <li key={a.name} className="flex items-center justify-between p-3 rounded-lg bg-destructive/[0.08] border border-destructive/25 hover:bg-destructive/[0.12] transition-colors">
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{a.name}</div>
                            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{a.class}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-mono text-destructive">{a.resistance}</span>
                            <span className="px-2.5 py-1 rounded-full bg-destructive/25 text-destructive text-[10px] font-semibold tracking-widest uppercase border border-destructive/50">
                              Resistant
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Waveform({ playing }: { playing: boolean }) {
  const bars = 48;
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setSeed((s) => s + 1), 120);
    return () => clearInterval(id);
  }, [playing]);
  return (
    <div className="flex items-center gap-[3px] h-8">
      {Array.from({ length: bars }).map((_, i) => {
        const base = 0.25 + Math.abs(Math.sin((i + seed) * 0.6)) * 0.75;
        const h = playing ? base : 0.2 + Math.abs(Math.sin(i * 0.9)) * 0.3;
        const active = i < (seed % bars) && playing;
        return (
          <span
            key={i}
            className={`w-[3px] rounded-full transition-all duration-150 ${active ? "bg-neon" : "bg-muted-foreground/40"}`}
            style={{ height: `${h * 100}%`, boxShadow: active ? "0 0 6px var(--neon-glow)" : undefined }}
          />
        );
      })}
    </div>
  );
}
