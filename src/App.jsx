import React, { useState, useEffect, useRef } from 'react';
import { Mic, Settings, Play, Square, X, Wifi, MessageCircle, Clock, Volume2, Activity, Zap, Radio, RefreshCw, AlertTriangle } from 'lucide-react';

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [whistleCount, setWhistleCount] = useState(0);
  const [targetWhistles, setTargetWhistles] = useState(3);
  const [sensitivity, setSensitivity] = useState(50);
  const [minDuration, setMinDuration] = useState(2.0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  
  const [status, setStatus] = useState('Ready'); 
  const [errorMessage, setErrorMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // Webhook URLs
  const [alexaUrl, setAlexaUrl] = useState('');
  const [whatsappUrl, setWhatsappUrl] = useState('');

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const animationRef = useRef(null);
  const streamRef = useRef(null);
  
  // Logic Refs
  const loudFramesRef = useRef(0);
  const statusRef = useRef('Ready');
  const sensitivityRef = useRef(50);
  const minDurationRef = useRef(2.0);
  const lastWhistleTimeRef = useRef(0);
  const targetWhistlesRef = useRef(3);
  const whistleCountRef = useRef(0);

  const COOLDOWN_MS = 5000; 
  
  // Sync Refs
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);
  useEffect(() => { minDurationRef.current = minDuration; }, [minDuration]);
  useEffect(() => { targetWhistlesRef.current = targetWhistles; }, [targetWhistles]);
  useEffect(() => { whistleCountRef.current = whistleCount; }, [whistleCount]);

  // Load/Save Settings
  useEffect(() => {
    try {
        const savedAlexa = localStorage.getItem('alexaUrl');
        const savedWhatsapp = localStorage.getItem('whatsappUrl');
        const savedTarget = localStorage.getItem('targetWhistles');
        const savedDuration = localStorage.getItem('minDuration');
        
        if (savedAlexa) setAlexaUrl(savedAlexa);
        if (savedWhatsapp) setWhatsappUrl(savedWhatsapp);
        if (savedTarget) {
            setTargetWhistles(parseInt(savedTarget));
            targetWhistlesRef.current = parseInt(savedTarget);
        }
        if (savedDuration) {
            setMinDuration(parseFloat(savedDuration));
            minDurationRef.current = parseFloat(savedDuration);
        }
    } catch (e) {
        console.warn("Storage access failed", e);
    }

    return () => stopListening();
  }, []);

  useEffect(() => {
    try {
        localStorage.setItem('alexaUrl', alexaUrl);
        localStorage.setItem('whatsappUrl', whatsappUrl);
        localStorage.setItem('targetWhistles', targetWhistles);
        localStorage.setItem('minDuration', minDuration);
    } catch (e) {
        // Ignore storage errors
    }
  }, [alexaUrl, whatsappUrl, targetWhistles, minDuration]);

  // Trigger Logic
  useEffect(() => {
    if (whistleCount >= targetWhistles && targetWhistles > 0 && status !== 'Triggered') {
      triggerAlarm();
    }
  }, [whistleCount, targetWhistles, status]);

  const startListening = async () => {
    try {
      setErrorMessage('');
      
      // Safety check for browser support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Microphone not supported on this browser.");
      }

      // 1. Initialize Audio Context (Must happen inside user gesture)
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      
      // Resume if suspended (common on mobile)
      if (audioContext.state === 'suspended') {
          await audioContext.resume();
      }
      
      audioContextRef.current = audioContext;

      // 2. Request Microphone (Simplified constraints to prevent OverconstrainedError)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // 3. Setup Analyzer
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8; // Smooths out the visualizer
      analyserRef.current = analyser;
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      // 4. Reset Logic
      loudFramesRef.current = 0;
      lastWhistleTimeRef.current = Date.now();
      
      setIsListening(true);
      setStatus('Listening');
      statusRef.current = 'Listening';
      
      // 5. Start Loop
      analyzeAudio();

    } catch (err) {
      console.error("Mic Error:", err);
      // specific error handling for common mobile issues
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setErrorMessage('Microphone permission denied. Please enable it in settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setErrorMessage('No microphone found.');
      } else {
          setErrorMessage(`Error: ${err.message || 'Could not start audio.'}`);
      }
      stopListening();
    }
  };

  const stopListening = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(e => console.log(e));
    }
    
    setIsListening(false);
    setStatus('Ready');
    statusRef.current = 'Ready';
    setVolumeLevel(0);
    loudFramesRef.current = 0;
  };

  const analyzeAudio = () => {
    if (!analyserRef.current) return;
    
    try {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate Volume (RMS)
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        
        // Normalize 0-100 with a slight boost curve
        const normalizedVolume = Math.min((rms / 255) * 100 * 2.5, 100);
        
        // Use functional state update to prevent stale closure issues, but we used ref for logic so it's fine
        // Update UI state (throttled by RAF naturally)
        setVolumeLevel(normalizedVolume);

        // LOGIC CHECK
        const threshold = 100 - sensitivityRef.current; 
        const now = Date.now();
        
        // "Leaky Bucket" Algorithm for cleaner detection
        if (normalizedVolume > threshold) {
            loudFramesRef.current += 1;
        } else {
            // Decay count slowly instead of hard reset
            loudFramesRef.current = Math.max(0, loudFramesRef.current - 1);
        }

        const requiredFrames = minDurationRef.current * 60; // approx 60fps

        if (statusRef.current === 'Listening' && (now - lastWhistleTimeRef.current > COOLDOWN_MS)) {
            if (loudFramesRef.current > requiredFrames) {
                handleWhistleDetected();
            }
        }
    } catch (e) {
        console.error("Audio loop error", e);
    }

    animationRef.current = requestAnimationFrame(analyzeAudio);
  };

  const handleWhistleDetected = () => {
    const now = Date.now();
    lastWhistleTimeRef.current = now;
    loudFramesRef.current = 0; 
    setStatus('Cooldown');
    setWhistleCount(prev => prev + 1);
    
    try {
        const beep = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-positive-interface-beep-221.mp3');
        beep.volume = 1.0;
        beep.play().catch(e => console.log("Audio play error", e));
    } catch (e) {
        console.log("Audio constructor error", e);
    }

    setTimeout(() => {
        if (whistleCountRef.current < targetWhistlesRef.current) {
            setStatus('Listening');
        }
    }, COOLDOWN_MS);
  };

  const triggerAlarm = async () => {
    setStatus('Triggered');
    stopListening();

    try {
        const alarm = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-alarm-digital-clock-beep-989.mp3');
        alarm.loop = true;
        alarm.play().catch(e => console.log("Alarm play error", e));
        setTimeout(() => { 
            alarm.pause(); 
            alarm.currentTime = 0; 
        }, 10000);
    } catch (e) {
        console.log("Alarm error", e);
    }

    let notifications = [];
    
    if (alexaUrl) {
      notifications.push(fetch(alexaUrl, { method: 'GET', mode: 'no-cors' }).catch(e => console.log("Webhook fail", e)));
    }
    
    if (whatsappUrl) {
      notifications.push(fetch(whatsappUrl, { method: 'GET', mode: 'no-cors' }).catch(e => console.log("Webhook fail", e)));
    }

    if (notifications.length > 0) {
        await Promise.all(notifications);
        alert(`Target reached! Notifications sent.`);
    } else {
        alert("Target reached!");
    }
  };

  const resetApp = () => {
    stopListening();
    setWhistleCount(0);
    setStatus('Ready');
  };

  // UI Constants
  const RADIUS = 120;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  return (
    <div className="h-[100dvh] w-full bg-slate-950 text-slate-100 font-sans flex flex-col overflow-hidden touch-none select-none relative bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
      
      {/* --- Ambient Background Glows --- */}
      <div className="absolute top-0 left-0 w-full h-1/2 bg-cyan-500/5 blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-0 right-0 w-full h-1/2 bg-violet-500/5 blur-[120px] pointer-events-none"></div>

      {/* --- Header --- */}
      <header className="h-16 px-6 flex justify-between items-center shrink-0 border-b border-white/5 bg-slate-950/50 backdrop-blur-sm z-10">
         <div className="flex items-center gap-3">
            <div className="relative">
                <div className="absolute inset-0 bg-cyan-500 blur-md opacity-20"></div>
                <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-cyan-400 relative z-10 shadow-lg">
                    <Mic size={18} />
                </div>
            </div>
            <span className="font-bold text-lg tracking-wide text-white">Whistle<span className="text-cyan-400">Sync</span></span>
         </div>
         <button 
            onClick={() => setShowSettings(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:bg-white/5 active:scale-95 text-slate-400 hover:text-cyan-400"
         >
            <Settings size={22} />
         </button>
      </header>

      {/* --- Main Content --- */}
      <main className="flex-1 flex flex-col items-center justify-center relative p-4 gap-10">
         
         {/* STATUS BADGE */}
         <div className="h-12 flex items-end">
             {status === 'Ready' && (
                 <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-slate-700 bg-slate-900/50 text-slate-400 text-sm font-medium tracking-wider uppercase">
                     <Radio size={14} /> System Ready
                 </div>
             )}
             {status === 'Listening' && (
                <div className="flex items-center gap-3 px-5 py-2 rounded-full border border-cyan-500/30 bg-cyan-950/30 shadow-[0_0_15px_rgba(34,211,238,0.1)]">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
                    </span>
                    <span className="text-cyan-300 font-bold uppercase tracking-widest text-xs">Monitoring Audio</span>
                </div>
             )}
             {status === 'Cooldown' && (
                <div className="flex items-center gap-3 px-5 py-2 rounded-full border border-amber-500/30 bg-amber-950/30">
                    <Clock size={16} className="text-amber-500 animate-spin-slow" />
                    <span className="text-amber-500 font-bold uppercase tracking-widest text-xs">Processing (5s)</span>
                </div>
             )}
             {status === 'Triggered' && (
                <div className="flex items-center gap-3 px-6 py-3 rounded-full bg-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.5)] animate-bounce">
                    <Activity size={20} className="text-white" />
                    <span className="text-white font-black uppercase tracking-widest text-sm">TARGET REACHED</span>
                </div>
             )}
         </div>

         {/* FUTURISTIC HUD VISUALIZER */}
         <div className="relative w-80 h-80 flex items-center justify-center">
            
            {/* Outer Static Ring */}
            <svg className="absolute inset-0 w-full h-full rotate-[-90deg]">
               <circle cx="50%" cy="50%" r="48%" fill="none" stroke="#1e293b" strokeWidth="6" />
               <circle cx="50%" cy="50%" r="42%" fill="none" stroke="#1e293b" strokeWidth="1" strokeDasharray="4 4" />
            </svg>

            {/* Dynamic Volume Arc (Glow effect) */}
            <svg className="absolute inset-0 w-full h-full rotate-[-90deg] drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]">
               <circle 
                  cx="50%" cy="50%" r="48%" 
                  fill="none" 
                  stroke={volumeLevel > (100 - sensitivity) ? "#fff" : "#22d3ee"} 
                  strokeWidth="6" 
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE - ((volumeLevel / 100) * CIRCUMFERENCE)}
                  className="transition-all duration-100 ease-linear"
                  style={{ opacity: isListening ? 1 : 0 }}
               />
            </svg>

            {/* Threshold Marker */}
            <div 
                className="absolute inset-0 pointer-events-none transition-all duration-300"
                style={{ transform: `rotate(${( (100-sensitivity)/100 * 360 )}deg)` }}
            >
                 <div className="absolute top-0 left-1/2 -translate-x-1/2 -mt-1.5 w-0.5 h-8 bg-white z-20 shadow-[0_0_10px_white]" />
            </div>

            {/* Central Data Display */}
            <div className="flex flex-col items-center z-10 relative">
                {/* Glass Panel Background */}
                <div className="absolute inset-[-40px] bg-slate-900/50 backdrop-blur-sm rounded-full -z-10 border border-white/5"></div>
                
                <span className="text-slate-500 font-mono text-[10px] uppercase tracking-[0.2em] mb-2">Cycle Count</span>
                <div className="relative">
                    <span className="text-[6rem] font-bold leading-none tracking-tighter tabular-nums text-white drop-shadow-2xl font-mono">
                        {whistleCount}
                    </span>
                </div>
                <div className="flex items-center gap-2 mt-4 px-3 py-1 bg-slate-800/80 rounded border border-slate-700">
                    <span className="text-[10px] text-slate-400 font-mono uppercase">Target</span>
                    <span className="text-sm font-bold text-cyan-400 font-mono">{targetWhistles}</span>
                </div>
            </div>
         </div>
         
         {/* Audio Telemetry */}
         <div className="h-8 text-center px-4 w-full max-w-xs">
             {isListening && volumeLevel > 2 && (
                 <div className="flex justify-between items-center text-[10px] font-mono text-cyan-500/80">
                    <span>LVL: {Math.round(volumeLevel).toString().padStart(3, '0')}</span>
                    <div className="flex-1 mx-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-500/50" style={{ width: `${volumeLevel}%` }}></div>
                    </div>
                    <span>THR: {100-sensitivity}</span>
                 </div>
             )}
         </div>

      </main>

      {/* --- Footer Controls --- */}
      <footer className="p-6 bg-slate-950/80 backdrop-blur-md border-t border-white/5 shrink-0 safe-area-bottom z-20">
         {!isListening ? (
             <button 
                onClick={startListening}
                className="group relative w-full h-16 bg-cyan-500 hover:bg-cyan-400 rounded-lg flex items-center justify-center gap-3 text-slate-950 font-bold text-xl shadow-[0_0_20px_rgba(6,182,212,0.3)] active:scale-[0.99] transition-all overflow-hidden"
             >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                <Play fill="currentColor" size={24} /> 
                <span className="tracking-wider">INITIALIZE</span>
             </button>
         ) : (
             <div className="flex gap-4">
                <button 
                    onClick={stopListening}
                    className="flex-1 h-16 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center gap-3 text-white font-bold text-lg border border-slate-700 shadow-lg active:scale-[0.99] transition-all"
                >
                    <Square fill="currentColor" size={20} /> TERMINATE
                </button>
                <button 
                    onClick={resetApp}
                    className="w-16 h-16 bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center justify-center text-slate-400 hover:text-white border border-slate-700 active:scale-[0.99] transition-all"
                >
                    <RefreshCw size={24} />
                </button>
             </div>
         )}
      </footer>

      {/* --- Settings Modal (Fixed Overlay) --- */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex flex-col animate-in fade-in duration-200">
            {/* Modal Header */}
            <div className="h-16 px-6 flex justify-between items-center border-b border-white/10 shrink-0 bg-slate-950/50">
                <div className="flex items-center gap-3">
                    <Settings size={20} className="text-cyan-400" />
                    <h2 className="text-lg font-bold text-white tracking-wide">SYSTEM CONFIG</h2>
                </div>
                <button 
                    onClick={() => setShowSettings(false)} 
                    className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center text-slate-300 hover:text-white border border-slate-700"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                
                {/* Target Section */}
                <section>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 block font-mono">Target Threshold</label>
                    <div className="grid grid-cols-4 gap-3">
                        {[1, 2, 3, 4, 5, 6, 8, 10].map(num => (
                            <button 
                                key={num}
                                onClick={() => setTargetWhistles(num)}
                                className={`h-12 rounded bg-slate-900 border font-mono font-bold text-lg transition-all ${
                                    targetWhistles === num 
                                    ? 'border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.15)]' 
                                    : 'border-slate-800 text-slate-500 hover:border-slate-600'
                                }`}
                            >
                                {num}
                            </button>
                        ))}
                    </div>
                </section>

                {/* Sensitivity Section */}
                <section className="p-5 rounded-lg border border-slate-800 bg-slate-900/50">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-3">
                            <Volume2 size={20} className="text-cyan-400" />
                            <div>
                                <h3 className="font-bold text-sm text-white uppercase tracking-wide">Input Gain</h3>
                                <p className="text-[10px] text-slate-500 font-mono">SIGNAL SENSITIVITY</p>
                            </div>
                        </div>
                        <span className="font-mono text-xl font-bold text-cyan-400">{sensitivity}%</span>
                    </div>
                    <input 
                        type="range" min="1" max="95" 
                        value={sensitivity} 
                        onChange={(e) => setSensitivity(Number(e.target.value))}
                        className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                </section>

                {/* Duration Section */}
                <section className="p-5 rounded-lg border border-slate-800 bg-slate-900/50">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-3">
                            <Zap size={20} className="text-violet-400" />
                            <div>
                                <h3 className="font-bold text-sm text-white uppercase tracking-wide">Pulse Width</h3>
                                <p className="text-[10px] text-slate-500 font-mono">MINIMUM DURATION</p>
                            </div>
                        </div>
                        <span className="font-mono text-xl font-bold text-violet-400">{minDuration}s</span>
                    </div>
                    <input 
                        type="range" min="0.5" max="5.0" step="0.5"
                        value={minDuration} 
                        onChange={(e) => setMinDuration(Number(e.target.value))}
                        className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-400"
                    />
                </section>

                {/* Webhooks Section */}
                <section>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 block font-mono">Data Uplinks</label>
                    <div className="space-y-3">
                        <div className="flex items-center gap-3 p-3 rounded bg-slate-900 border border-slate-800 focus-within:border-cyan-500/50 transition-colors">
                            <Wifi size={18} className={alexaUrl ? "text-cyan-400" : "text-slate-600"} />
                            <input 
                                type="text" 
                                placeholder="ALEXA_WEBHOOK_URI"
                                value={alexaUrl} 
                                onChange={(e) => setAlexaUrl(e.target.value)}
                                className="flex-1 bg-transparent text-xs font-mono text-slate-300 placeholder-slate-700 focus:outline-none"
                            />
                        </div>
                         <div className="flex items-center gap-3 p-3 rounded bg-slate-900 border border-slate-800 focus-within:border-green-500/50 transition-colors">
                            <MessageCircle size={18} className={whatsappUrl ? "text-green-400" : "text-slate-600"} />
                            <input 
                                type="text" 
                                placeholder="WHATSAPP_API_ENDPOINT"
                                value={whatsappUrl} 
                                onChange={(e) => setWhatsappUrl(e.target.value)}
                                className="flex-1 bg-transparent text-xs font-mono text-slate-300 placeholder-slate-700 focus:outline-none"
                            />
                        </div>
                    </div>
                </section>
            </div>
        </div>
      )}

      {/* Error Toast */}
      {errorMessage && (
        <div className="fixed top-20 left-4 right-4 bg-rose-500/10 border border-rose-500/50 text-rose-200 p-4 rounded backdrop-blur-md flex items-center gap-3 animate-in slide-in-from-top-5 z-50">
            <AlertTriangle size={20} />
            <span className="font-mono text-xs">{errorMessage}</span>
        </div>
      )}

    </div>
  );
}