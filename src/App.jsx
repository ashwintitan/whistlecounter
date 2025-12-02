import React, { useState, useEffect, useRef } from 'react';
import { Mic, Settings, Play, Square, X, Wifi, MessageCircle, Clock, Volume2, Check, AlertCircle, RefreshCw } from 'lucide-react';

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [whistleCount, setWhistleCount] = useState(0);
  const [targetWhistles, setTargetWhistles] = useState(3);
  const [sensitivity, setSensitivity] = useState(50); // 0-100
  const [minDuration, setMinDuration] = useState(2.0); // Seconds
  const [volumeLevel, setVolumeLevel] = useState(0);
  
  const [status, setStatus] = useState('Ready'); // Ready, Listening, Cooldown, Triggered
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
  
  // LOGIC REFS
  const loudFramesRef = useRef(0);
  const statusRef = useRef('Ready');
  const sensitivityRef = useRef(50);
  const minDurationRef = useRef(2.0);
  const lastWhistleTimeRef = useRef(0);
  const targetWhistlesRef = useRef(3);
  const whistleCountRef = useRef(0);

  // Constants
  const COOLDOWN_MS = 5000; 
  
  // Sync Refs
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);
  useEffect(() => { minDurationRef.current = minDuration; }, [minDuration]);
  useEffect(() => { targetWhistlesRef.current = targetWhistles; }, [targetWhistles]);
  useEffect(() => { whistleCountRef.current = whistleCount; }, [whistleCount]);

  // Load/Save Settings
  useEffect(() => {
    const savedAlexa = localStorage.getItem('alexaUrl');
    const savedWhatsapp = localStorage.getItem('whatsappUrl');
    const savedTarget = localStorage.getItem('targetWhistles');
    const savedDuration = localStorage.getItem('minDuration');
    
    if (savedAlexa) setAlexaUrl(savedAlexa);
    if (savedWhatsapp) setWhatsappUrl(savedWhatsapp);
    if (savedTarget) {
        const target = parseInt(savedTarget);
        setTargetWhistles(target);
        targetWhistlesRef.current = target;
    }
    if (savedDuration) {
        const duration = parseFloat(savedDuration);
        setMinDuration(duration);
        minDurationRef.current = duration;
    }

    return () => stopListening();
  }, []);

  useEffect(() => {
    localStorage.setItem('alexaUrl', alexaUrl);
    localStorage.setItem('whatsappUrl', whatsappUrl);
    localStorage.setItem('targetWhistles', targetWhistles);
    localStorage.setItem('minDuration', minDuration);
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
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
      });
      streamRef.current = stream;
      
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      loudFramesRef.current = 0;
      lastWhistleTimeRef.current = Date.now();
      
      setIsListening(true);
      setStatus('Listening');
      statusRef.current = 'Listening';
      analyzeAudio();
    } catch (err) {
      console.error(err);
      setErrorMessage('Mic Access Denied. Check Permissions.');
    }
  };

  const stopListening = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (audioContextRef.current) audioContextRef.current.close();
    
    setIsListening(false);
    setStatus('Ready');
    statusRef.current = 'Ready';
    setVolumeLevel(0);
    loudFramesRef.current = 0;
  };

  const analyzeAudio = () => {
    if (!analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
    const rms = Math.sqrt(sum / dataArray.length);
    const normalizedVolume = Math.min((rms / 255) * 100 * 2, 100);
    
    setVolumeLevel(normalizedVolume);

    const threshold = 100 - sensitivityRef.current; 
    const now = Date.now();
    
    if (normalizedVolume > threshold) {
      loudFramesRef.current += 1;
    } else {
      loudFramesRef.current = Math.max(0, loudFramesRef.current - 1);
    }

    const requiredFrames = minDurationRef.current * 60;

    if (statusRef.current === 'Listening' && (now - lastWhistleTimeRef.current > COOLDOWN_MS)) {
       if (loudFramesRef.current > requiredFrames) {
          handleWhistleDetected();
       }
    }
    animationRef.current = requestAnimationFrame(analyzeAudio);
  };

  const handleWhistleDetected = () => {
    const now = Date.now();
    lastWhistleTimeRef.current = now;
    loudFramesRef.current = 0; 
    setStatus('Cooldown');
    setWhistleCount(prev => prev + 1);
    
    const beep = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-positive-interface-beep-221.mp3');
    beep.volume = 1.0;
    beep.play().catch(e => console.log(e));

    setTimeout(() => {
        if (whistleCountRef.current < targetWhistlesRef.current) {
            setStatus('Listening');
        }
    }, COOLDOWN_MS);
  };

  const triggerAlarm = async () => {
    setStatus('Triggered');
    stopListening();

    const alarm = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-alarm-digital-clock-beep-989.mp3');
    alarm.loop = true;
    alarm.play().catch(e => console.log(e));
    setTimeout(() => { alarm.pause(); alarm.currentTime = 0; }, 10000);

    let notifications = [];
    if (alexaUrl) notifications.push(fetch(alexaUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value1: 'Whistles Reached' }) }));
    if (whatsappUrl) notifications.push(fetch(whatsappUrl, { method: 'GET', mode: 'no-cors' }));

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

  // --- UI CONSTANTS & CALCULATIONS ---
  // Simple circle geometry
  const RADIUS = 120;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  
  // Progress Calculation
  const progressPercent = Math.min(whistleCount / targetWhistles, 1);
  const progressOffset = CIRCUMFERENCE - (progressPercent * CIRCUMFERENCE);

  // Volume Arc Calculation (Visualizer)
  // We map volume 0-100 to a partial arc
  const volumePercent = Math.min(volumeLevel, 100) / 100;
  const volumeDash = volumePercent * CIRCUMFERENCE;

  // Threshold Marker Rotation
  const thresholdPercent = (100 - sensitivity) / 100;
  // Map 0-1 to rotation degrees (assuming circle starts at -90)
  // But for simple visualizer, we might just mark the threshold on a bar. 
  // Let's stick to the cleaner concentric circle approach.

  return (
    // MAIN CONTAINER: Fixed viewport height, no scroll, no touch actions
    <div className="h-[100dvh] w-full bg-neutral-950 text-white font-sans flex flex-col overflow-hidden touch-none select-none">
      
      {/* --- Header: Minimal & Functional --- */}
      <header className="h-16 px-6 flex justify-between items-center shrink-0 border-b border-white/5">
         <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-black">
                <Mic size={20} strokeWidth={3} />
            </div>
            <span className="font-bold text-lg tracking-tight">Whistle<span className="text-orange-500">Count</span></span>
         </div>
         <button 
            onClick={() => setShowSettings(true)}
            className="w-10 h-10 bg-neutral-800 rounded-full flex items-center justify-center active:scale-95 transition-transform"
         >
            <Settings size={22} className="text-neutral-300" />
         </button>
      </header>

      {/* --- Main Content: Centered & Flexible --- */}
      <main className="flex-1 flex flex-col items-center justify-center relative p-4 gap-8">
         
         {/* STATUS INDICATOR (Large & Clear) */}
         <div className="flex flex-col items-center gap-2 h-16 justify-end">
             {status === 'Ready' && <span className="text-neutral-400 text-xl font-medium">Ready to start</span>}
             {status === 'Listening' && (
                <div className="flex items-center gap-3 px-4 py-2 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                    <span className="text-emerald-400 font-bold uppercase tracking-wide text-sm">Listening...</span>
                </div>
             )}
             {status === 'Cooldown' && (
                <div className="flex items-center gap-3 px-4 py-2 bg-amber-500/10 rounded-full border border-amber-500/20">
                    <Clock size={16} className="text-amber-500 animate-spin-slow" />
                    <span className="text-amber-500 font-bold uppercase tracking-wide text-sm">Wait (5s)</span>
                </div>
             )}
             {status === 'Triggered' && (
                <div className="flex items-center gap-3 px-6 py-3 bg-red-500 rounded-full shadow-[0_0_20px_rgba(239,68,68,0.4)] animate-bounce">
                    <AlertCircle size={24} className="text-white" />
                    <span className="text-white font-black uppercase tracking-wide text-lg">DONE!</span>
                </div>
             )}
         </div>

         {/* MAIN VISUALIZER */}
         <div className="relative w-72 h-72 flex items-center justify-center">
            
            {/* 1. Base Track */}
            <svg className="absolute inset-0 w-full h-full rotate-[-90deg]">
               <circle 
                 cx="50%" cy="50%" r="48%" 
                 fill="none" stroke="#262626" strokeWidth="20" strokeLinecap="round" 
               />
            </svg>

            {/* 2. Volume Meter (Dynamic Orange Ring) */}
            <svg className="absolute inset-0 w-full h-full rotate-[-90deg]">
               <circle 
                  cx="50%" cy="50%" r="48%" 
                  fill="none" 
                  stroke={volumeLevel > (100 - sensitivity) ? "#ffffff" : "#f97316"} 
                  strokeWidth="20" 
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE - ((volumeLevel / 100) * CIRCUMFERENCE)}
                  className="transition-all duration-75 ease-out"
                  style={{ opacity: isListening ? 1 : 0.3 }}
               />
            </svg>

            {/* 3. Threshold Marker (Little notch to hit) */}
            <div 
                className="absolute inset-0 pointer-events-none transition-all duration-300"
                style={{ transform: `rotate(${( (100-sensitivity)/100 * 360 )}deg)` }}
            >
                {/* Visual marker at the top (start) rotated by threshold */}
                 <div className="absolute top-0 left-1/2 -translate-x-1/2 -mt-1 w-1 h-6 bg-white z-20 shadow-[0_0_5px_black]" />
            </div>

            {/* 4. Center Counter */}
            <div className="flex flex-col items-center z-10">
                <span className="text-neutral-500 font-bold text-sm uppercase tracking-widest">Count</span>
                <span className="text-[7rem] font-bold leading-none tracking-tighter tabular-nums">
                    {whistleCount}
                </span>
                <div className="bg-neutral-800 px-3 py-1 rounded-full mt-2">
                    <span className="text-neutral-400 font-semibold text-sm">Target: <span className="text-white">{targetWhistles}</span></span>
                </div>
            </div>
         </div>
         
         {/* Instruction / Helper Text */}
         <div className="h-8 text-center px-4">
             {isListening && volumeLevel > 5 && (
                 <p className="text-xs text-neutral-500 font-mono">
                     Loudness: {Math.round(volumeLevel)}% / Req: {100-sensitivity}%
                 </p>
             )}
         </div>

      </main>

      {/* --- Footer: Huge Action Button --- */}
      <footer className="p-6 bg-neutral-900 border-t border-white/5 shrink-0 safe-area-bottom">
         {!isListening ? (
             <button 
                onClick={startListening}
                className="w-full h-20 bg-orange-500 hover:bg-orange-400 rounded-2xl flex items-center justify-center gap-3 text-black font-bold text-2xl shadow-lg active:scale-[0.98] transition-all"
             >
                <Play fill="currentColor" size={32} /> START
             </button>
         ) : (
             <div className="flex gap-4">
                <button 
                    onClick={stopListening}
                    className="flex-1 h-20 bg-neutral-800 rounded-2xl flex items-center justify-center gap-3 text-white font-bold text-xl border border-white/10 active:scale-[0.98] transition-all"
                >
                    <Square fill="currentColor" size={24} /> STOP
                </button>
                <button 
                    onClick={resetApp}
                    className="w-20 h-20 bg-neutral-800 rounded-2xl flex items-center justify-center text-neutral-400 border border-white/10 active:scale-[0.98] transition-all"
                >
                    <RefreshCw size={28} />
                </button>
             </div>
         )}
      </footer>

      {/* --- Settings Sheet (Full Overlay) --- */}
      {showSettings && (
        <div className="absolute inset-0 z-50 bg-neutral-950 flex flex-col animate-in slide-in-from-bottom-full duration-300">
            {/* Header */}
            <div className="h-16 px-6 flex justify-between items-center border-b border-white/10 bg-neutral-900">
                <h2 className="text-xl font-bold">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="w-10 h-10 bg-neutral-800 rounded-full flex items-center justify-center">
                    <X size={24} />
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                
                {/* Target Section */}
                <section>
                    <label className="text-sm font-bold text-neutral-500 uppercase tracking-wider mb-4 block">Target Whistles</label>
                    <div className="grid grid-cols-4 gap-3">
                        {[1, 2, 3, 4, 5, 6, 8, 10].map(num => (
                            <button 
                                key={num}
                                onClick={() => setTargetWhistles(num)}
                                className={`h-14 rounded-xl font-bold text-lg transition-all border-2 ${
                                    targetWhistles === num 
                                    ? 'bg-orange-500 border-orange-500 text-black' 
                                    : 'bg-neutral-900 border-neutral-800 text-neutral-400'
                                }`}
                            >
                                {num}
                            </button>
                        ))}
                    </div>
                </section>

                {/* Sensitivity Section */}
                <section className="bg-neutral-900 p-5 rounded-2xl border border-white/5">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-orange-500/10 rounded-lg text-orange-500"><Volume2 size={24} /></div>
                            <div>
                                <h3 className="font-bold text-lg">Mic Sensitivity</h3>
                                <p className="text-xs text-neutral-500">Adjust if whistles are missed</p>
                            </div>
                        </div>
                        <span className="font-mono text-xl font-bold text-orange-500">{sensitivity}%</span>
                    </div>
                    <input 
                        type="range" min="1" max="95" 
                        value={sensitivity} 
                        onChange={(e) => setSensitivity(Number(e.target.value))}
                        className="w-full h-4 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    />
                    <div className="flex justify-between text-xs text-neutral-500 mt-2 font-bold uppercase">
                        <span>Hard to Trigger</span>
                        <span>Easy to Trigger</span>
                    </div>
                </section>

                {/* Duration Section */}
                <section className="bg-neutral-900 p-5 rounded-2xl border border-white/5">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500"><Clock size={24} /></div>
                            <div>
                                <h3 className="font-bold text-lg">Min Duration</h3>
                                <p className="text-xs text-neutral-500">Ignore short noises</p>
                            </div>
                        </div>
                        <span className="font-mono text-xl font-bold text-blue-500">{minDuration}s</span>
                    </div>
                    <input 
                        type="range" min="0.5" max="5.0" step="0.5"
                        value={minDuration} 
                        onChange={(e) => setMinDuration(Number(e.target.value))}
                        className="w-full h-4 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                </section>

                {/* Automation Section */}
                <section>
                    <label className="text-sm font-bold text-neutral-500 uppercase tracking-wider mb-4 block">Automations</label>
                    <div className="space-y-3">
                        <div className="flex items-center gap-3 bg-neutral-900 p-4 rounded-xl border border-white/5">
                            <Wifi size={20} className={alexaUrl ? "text-cyan-400" : "text-neutral-600"} />
                            <input 
                                type="text" 
                                placeholder="Paste Alexa Webhook URL"
                                value={alexaUrl} 
                                onChange={(e) => setAlexaUrl(e.target.value)}
                                className="flex-1 bg-transparent text-neutral-200 placeholder-neutral-600 focus:outline-none h-full"
                            />
                        </div>
                         <div className="flex items-center gap-3 bg-neutral-900 p-4 rounded-xl border border-white/5">
                            <MessageCircle size={20} className={whatsappUrl ? "text-green-400" : "text-neutral-600"} />
                            <input 
                                type="text" 
                                placeholder="Paste WhatsApp URL"
                                value={whatsappUrl} 
                                onChange={(e) => setWhatsappUrl(e.target.value)}
                                className="flex-1 bg-transparent text-neutral-200 placeholder-neutral-600 focus:outline-none h-full"
                            />
                        </div>
                    </div>
                </section>
            </div>
        </div>
      )}

      {/* Error Toast */}
      {errorMessage && (
        <div className="fixed top-20 left-4 right-4 bg-red-500/90 text-white p-4 rounded-xl shadow-xl flex items-center gap-3 animate-in slide-in-from-top-5 z-40">
            <AlertCircle size={24} />
            <span className="font-medium">{errorMessage}</span>
        </div>
      )}

    </div>
  );
}