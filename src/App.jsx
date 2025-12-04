import React, { useState, useEffect, useRef } from 'react';
import { Mic, Settings, Play, Square, X, Wifi, MessageCircle, Clock, Volume2, Activity, Zap, RefreshCw, AlertTriangle } from 'lucide-react';

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
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Microphone not supported on this browser.");
      }

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      
      if (audioContext.state === 'suspended') {
          await audioContext.resume();
      }
      
      audioContextRef.current = audioContext;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8; 
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
      console.error("Mic Error:", err);
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

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const normalizedVolume = Math.min((rms / 255) * 100 * 2.5, 100);
        
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

  // --- UI Helpers ---
  const getStatusText = () => {
      if (status === 'Ready') return 'Ready to Start';
      if (status === 'Listening') return 'Listening...';
      if (status === 'Cooldown') return 'Cooling Down';
      if (status === 'Triggered') return 'Target Reached';
      return '';
  };

  const getStatusColor = () => {
      if (status === 'Ready') return 'text-zinc-500';
      if (status === 'Listening') return 'text-emerald-400';
      if (status === 'Cooldown') return 'text-amber-400';
      if (status === 'Triggered') return 'text-rose-500';
      return 'text-zinc-500';
  };

  return (
    <div className="h-[100dvh] w-full bg-zinc-950 text-white font-sans flex flex-col items-center justify-center overflow-hidden touch-none select-none relative selection:bg-transparent">
      
      {/* --- Main Content Area (Centered) --- */}
      <div className="flex flex-col items-center justify-center gap-12 w-full max-w-sm px-6 z-10">
         
         {/* Top: Status Text */}
         <div className="text-center h-8 flex items-end justify-center">
             <span className={`text-sm font-bold tracking-[0.2em] uppercase transition-colors duration-300 ${getStatusColor()}`}>
                 {getStatusText()}
             </span>
         </div>

         {/* Middle: The Big Number & Visualizer */}
         <div className="relative flex items-center justify-center">
            
            {/* Visualizer Ring (Grows with volume) */}
            <div 
                className={`absolute rounded-full border-2 border-current transition-all duration-75 ease-out opacity-20 ${getStatusColor()}`}
                style={{ 
                    width: `${Math.max(200, 200 + volumeLevel * 1.5)}px`, 
                    height: `${Math.max(200, 200 + volumeLevel * 1.5)}px`,
                    opacity: isListening ? 0.2 + (volumeLevel/200) : 0
                }}
            />

            {/* Threshold Ring (Static Guide) */}
            {isListening && (
                <div 
                    className="absolute w-[280px] h-[280px] rounded-full border border-white/5 pointer-events-none"
                    style={{ transform: `scale(${1 + ((100-sensitivity)/100) * 0.5})` }} // Rough visual approximation
                />
            )}

            {/* The Main Number */}
            <div className="relative z-10 flex flex-col items-center">
                <span className={`text-[10rem] leading-none font-bold tabular-nums tracking-tighter transition-all duration-300 ${status === 'Listening' ? 'text-white' : 'text-zinc-600'}`}>
                    {whistleCount}
                </span>
            </div>
         </div>

         {/* Bottom: Target & Controls */}
         <div className="flex flex-col items-center gap-8 w-full">
             
             {/* Target Display */}
             <div className="text-center">
                 <span className="text-zinc-500 text-sm font-medium uppercase tracking-widest">
                     Target: <span className="text-white font-bold">{targetWhistles}</span>
                 </span>
             </div>

             {/* Controls Group */}
             <div className="flex flex-col items-center gap-4 w-full">
                 {!isListening ? (
                     <button 
                        onClick={startListening}
                        className="group relative w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.1)] hover:scale-110 active:scale-95 transition-all duration-300"
                     >
                        <Play fill="black" className="text-black ml-1" size={32} />
                        <span className="absolute -bottom-8 text-[10px] text-zinc-500 font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Start</span>
                     </button>
                 ) : (
                     <div className="flex items-center gap-8">
                        <button 
                            onClick={resetApp}
                            className="w-14 h-14 bg-zinc-900 rounded-full flex items-center justify-center text-zinc-500 hover:text-white border border-zinc-800 hover:border-zinc-600 active:scale-95 transition-all"
                        >
                            <RefreshCw size={20} />
                        </button>
                        
                        <button 
                            onClick={stopListening}
                            className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center text-rose-500 hover:text-rose-400 border border-zinc-800 hover:border-rose-500/30 shadow-lg active:scale-95 transition-all"
                        >
                            <Square fill="currentColor" size={28} />
                        </button>
                        
                        <button 
                            onClick={() => setShowSettings(true)}
                            className="w-14 h-14 bg-zinc-900 rounded-full flex items-center justify-center text-zinc-500 hover:text-white border border-zinc-800 hover:border-zinc-600 active:scale-95 transition-all"
                        >
                            <Settings size={20} />
                        </button>
                     </div>
                 )}
                 
                 {/* Settings Button (Only visible when NOT listening for cleaner start) */}
                 {!isListening && (
                     <button 
                        onClick={() => setShowSettings(true)}
                        className="mt-4 text-zinc-600 hover:text-zinc-400 transition-colors"
                     >
                        <Settings size={24} />
                     </button>
                 )}
             </div>
         </div>

      </div>

      {/* --- Settings Overlay (Clean & Centered) --- */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-24 px-6 animate-in fade-in duration-200">
            <div className="w-full max-w-sm bg-[#556B2F] border border-[#6B8E23] rounded-3xl p-8 space-y-8 shadow-2xl text-[#FEFEE9]">
                
                {/* Header */}
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold tracking-wide">Settings</h2>
                    <button onClick={() => setShowSettings(false)} className="p-2 bg-[#4A5D29] rounded-full hover:bg-[#3E4E22] transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Target */}
                <div>
                    <label className="text-xs font-bold text-[#D0D9CD] uppercase tracking-widest mb-4 block">Target</label>
                    <div className="flex justify-between gap-2">
                        {[1, 2, 3, 4, 5].map(num => (
                            <button 
                                key={num}
                                onClick={() => setTargetWhistles(num)}
                                className={`w-10 h-12 rounded-lg font-bold text-lg transition-all border border-[#6B8E23] ${
                                    targetWhistles === num 
                                    ? 'bg-[#FEFEE9] text-[#556B2F] shadow-md' 
                                    : 'bg-[#4A5D29] text-[#D0D9CD] hover:bg-[#3E4E22]'
                                }`}
                            >
                                {num}
                            </button>
                        ))}
                         <button 
                                onClick={() => setTargetWhistles(Math.min(targetWhistles + 1, 20))}
                                className="w-10 h-12 rounded-lg bg-[#4A5D29] text-[#D0D9CD] font-bold border border-[#6B8E23] hover:bg-[#3E4E22]"
                            >+</button>
                    </div>
                </div>

                {/* Sliders */}
                <div className="space-y-6">
                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-xs font-bold text-[#D0D9CD] uppercase tracking-widest">Sensitivity</label>
                            <span className="text-xs text-[#FEFEE9] font-mono">{sensitivity}%</span>
                        </div>
                        <input 
                            type="range" min="1" max="95" 
                            value={sensitivity} 
                            onChange={(e) => setSensitivity(Number(e.target.value))}
                            className="w-full h-1 bg-[#4A5D29] rounded-lg appearance-none cursor-pointer accent-[#FEFEE9]"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-xs font-bold text-[#D0D9CD] uppercase tracking-widest">Duration</label>
                            <span className="text-xs text-[#FEFEE9] font-mono">{minDuration}s</span>
                        </div>
                        <input 
                            type="range" min="0.5" max="5.0" step="0.5"
                            value={minDuration} 
                            onChange={(e) => setMinDuration(Number(e.target.value))}
                            className="w-full h-1 bg-[#4A5D29] rounded-lg appearance-none cursor-pointer accent-[#FEFEE9]"
                        />
                    </div>
                </div>

                {/* Webhooks */}
                <div>
                    <label className="text-xs font-bold text-[#D0D9CD] uppercase tracking-widest mb-4 block">Connections</label>
                    <div className="space-y-3">
                        <input 
                            type="text" 
                            placeholder="Alexa URL"
                            value={alexaUrl} 
                            onChange={(e) => setAlexaUrl(e.target.value)}
                            className="w-full bg-[#4A5D29] border border-[#6B8E23] rounded-xl px-4 py-3 text-sm text-[#FEFEE9] placeholder-[#8F9C7A] focus:ring-1 focus:ring-[#FEFEE9] outline-none"
                        />
                        <input 
                            type="text" 
                            placeholder="WhatsApp URL"
                            value={whatsappUrl} 
                            onChange={(e) => setWhatsappUrl(e.target.value)}
                            className="w-full bg-[#4A5D29] border border-[#6B8E23] rounded-xl px-4 py-3 text-sm text-[#FEFEE9] placeholder-[#8F9C7A] focus:ring-1 focus:ring-[#FEFEE9] outline-none"
                        />
                    </div>
                </div>

            </div>
        </div>
      )}

      {/* Error Toast */}
      {errorMessage && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-800 text-rose-400 px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-5 z-50">
            <AlertTriangle size={18} />
            <span className="text-xs font-medium">{errorMessage}</span>
        </div>
      )}

    </div>
  );
}