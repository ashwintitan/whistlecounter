import React, { useState, useEffect, useRef } from 'react';
import { Mic, Settings, Play, Square, X, Wifi, MessageCircle, Clock, Volume2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [whistleCount, setWhistleCount] = useState(0);
  const [targetWhistles, setTargetWhistles] = useState(3);
  const [sensitivity, setSensitivity] = useState(50); // 0-100
  const [minDuration, setMinDuration] = useState(2.0); // Seconds
  const [volumeLevel, setVolumeLevel] = useState(0);
  
  // We keep lastWhistleTime in state for potential UI updates, but use ref for logic
  const [status, setStatus] = useState('Ready'); // Ready, Listening, Cooldown, Triggered
  const [errorMessage, setErrorMessage] = useState('');
  
  // Settings Visibility
  const [showSettings, setShowSettings] = useState(false);

  // Webhook URLs
  const [alexaUrl, setAlexaUrl] = useState('');
  const [whatsappUrl, setWhatsappUrl] = useState('');

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const animationRef = useRef(null);
  const streamRef = useRef(null);
  
  // LOGIC REFS (Crucial for fixing stale closures in the audio loop)
  const loudFramesRef = useRef(0);
  const statusRef = useRef('Ready');
  const sensitivityRef = useRef(50);
  const minDurationRef = useRef(2.0);
  const lastWhistleTimeRef = useRef(0);
  const targetWhistlesRef = useRef(3);
  const whistleCountRef = useRef(0);

  // Constants
  const COOLDOWN_MS = 5000; 
  
  // Sync Refs with State
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    minDurationRef.current = minDuration;
  }, [minDuration]);

  useEffect(() => {
    targetWhistlesRef.current = targetWhistles;
  }, [targetWhistles]);

  useEffect(() => {
    whistleCountRef.current = whistleCount;
  }, [whistleCount]);

  // Load settings on mount
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

    return () => {
      stopListening();
    };
  }, []);

  // Save settings when they change
  useEffect(() => {
    localStorage.setItem('alexaUrl', alexaUrl);
    localStorage.setItem('whatsappUrl', whatsappUrl);
    localStorage.setItem('targetWhistles', targetWhistles);
    localStorage.setItem('minDuration', minDuration);
  }, [alexaUrl, whatsappUrl, targetWhistles, minDuration]);

  // Trigger Logic (Moved out of loop to ensure React state updates correctly)
  useEffect(() => {
    if (whistleCount >= targetWhistles && targetWhistles > 0 && status !== 'Triggered') {
      triggerAlarm();
    }
  }, [whistleCount, targetWhistles, status]);

  const startListening = async () => {
    try {
      setErrorMessage('');
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        } 
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

      // Reset logic variables
      loudFramesRef.current = 0;
      lastWhistleTimeRef.current = Date.now(); // Prevent instant trigger
      
      setIsListening(true);
      setStatus('Listening');
      statusRef.current = 'Listening';
      
      analyzeAudio();
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setErrorMessage('Could not access microphone. Ensure you are using HTTPS (Netlify) or Localhost.');
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
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    
    // RMS is 0-255. Normalize to 0-100.
    const normalizedVolume = Math.min((rms / 255) * 100 * 2, 100);
    
    setVolumeLevel(normalizedVolume);

    // Read from Ref (latest value)
    const currentSensitivity = sensitivityRef.current;
    const threshold = 100 - currentSensitivity; 
    const now = Date.now();
    
    // Logic: Sustain Check with "Leaky Bucket"
    if (normalizedVolume > threshold) {
      loudFramesRef.current += 1;
    } else {
      loudFramesRef.current = Math.max(0, loudFramesRef.current - 1);
    }

    // Check Trigger
    const currentStatus = statusRef.current;
    const timeSinceLast = now - lastWhistleTimeRef.current;
    
    // Calculate required frames based on duration setting (approx 60fps)
    const requiredFrames = minDurationRef.current * 60;

    if (currentStatus === 'Listening' && timeSinceLast > COOLDOWN_MS) {
       if (loudFramesRef.current > requiredFrames) {
          handleWhistleDetected();
       }
    }

    animationRef.current = requestAnimationFrame(analyzeAudio);
  };

  const handleWhistleDetected = () => {
    const now = Date.now();
    lastWhistleTimeRef.current = now; // Update Ref immediately for loop
    loudFramesRef.current = 0; 
    
    // Update State
    setStatus('Cooldown');
    setWhistleCount(prev => prev + 1);
    
    // Play confirmation beep
    const beep = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-positive-interface-beep-221.mp3');
    beep.volume = 1.0;
    beep.play().catch(e => console.log('Audio play failed', e));

    setTimeout(() => {
        // Only go back to Listening if we haven't reached target yet
        // Accessing ref here to be safe inside timeout
        if (whistleCountRef.current < targetWhistlesRef.current) {
            setStatus('Listening');
        }
    }, COOLDOWN_MS);
  };

  const triggerAlarm = async () => {
    setStatus('Triggered');
    stopListening();

    // 1. Play local loud alarm
    const alarm = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-alarm-digital-clock-beep-989.mp3');
    alarm.loop = true;
    alarm.play().catch(e => console.log('Audio play failed', e));
    
    setTimeout(() => {
        alarm.pause();
        alarm.currentTime = 0;
    }, 10000);

    let notifications = [];

    if (alexaUrl) {
      notifications.push(
        fetch(alexaUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value1: 'Whistles Reached' })
        }).then(() => "Alexa triggered")
      );
    }

    if (whatsappUrl) {
        notifications.push(
            fetch(whatsappUrl, {
                method: 'GET',
                mode: 'no-cors'
            }).then(() => "WhatsApp triggered")
        );
    }

    if (notifications.length > 0) {
        await Promise.all(notifications);
        alert(`Target reached! Notifications sent.`);
    } else {
        alert("Target reached! (No notification URLs configured)");
    }
  };

  const resetApp = () => {
    stopListening();
    setWhistleCount(0);
    setStatus('Ready');
  };

  // --- UI HELPER FUNCTIONS ---

  const getStatusColor = () => {
    switch(status) {
      case 'Listening': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'Cooldown': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'Triggered': return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const getStatusText = () => {
    switch(status) {
      case 'Listening': return 'Listening for whistles...';
      case 'Cooldown': return 'Cooling down...';
      case 'Triggered': return 'Target Reached!';
      default: return 'Ready to start';
    }
  };

  const getGlowColor = () => {
    if (status === 'Listening') return 'rgba(16, 185, 129, '; // emerald
    if (status === 'Cooldown') return 'rgba(245, 158, 11, '; // amber
    if (status === 'Triggered') return 'rgba(244, 63, 94, '; // rose
    return 'rgba(139, 92, 246, '; // violet (default)
  };

  return (
    <div className="relative min-h-screen bg-zinc-950 text-white overflow-hidden selection:bg-violet-500/30 font-sans">
      
      {/* Background Ambient Gradients */}
      <div className="fixed top-[-20%] left-[-20%] w-[80vh] h-[80vh] rounded-full bg-violet-600/20 blur-[150px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-20%] w-[80vh] h-[80vh] rounded-full bg-emerald-600/10 blur-[150px] pointer-events-none" />

      {/* Main Content */}
      <div className="relative z-10 flex flex-col items-center min-h-screen p-6">
        
        {/* Header */}
        <div className="w-full max-w-lg flex justify-between items-center py-4 mb-8">
          <div className="flex items-center gap-2">
             <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Mic size={18} className="text-white" />
             </div>
             <span className="font-bold text-lg tracking-tight text-white/90">Whistle<span className="text-violet-400">Count</span></span>
          </div>
          <button 
              onClick={() => setShowSettings(true)}
              className="p-3 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all backdrop-blur-md border border-white/5 active:scale-95"
          >
              <Settings size={20} />
          </button>
        </div>

        {/* Centerpiece: The Pulse Counter */}
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md">
            
            <div className="relative mb-12 group cursor-default">
               {/* Dynamic Breathing Glow */}
               <div 
                  style={{ 
                      transform: `scale(${1 + volumeLevel/150})`, 
                      opacity: 0.3 + (volumeLevel/150),
                      backgroundColor: getGlowColor() + '0.4)'
                  }} 
                  className="absolute inset-0 blur-3xl rounded-full transition-all duration-75" 
               />
               
               {/* Main Circle Glass */}
               <div className="relative w-72 h-72 rounded-full bg-zinc-900/40 backdrop-blur-2xl border border-white/10 shadow-2xl flex flex-col items-center justify-center transition-all">
                  
                  {/* Progress Ring Background */}
                  <svg className="absolute inset-0 w-full h-full -rotate-90 p-4 opacity-20">
                    <circle cx="50%" cy="50%" r="48%" fill="none" stroke="currentColor" strokeWidth="4" />
                  </svg>

                   {/* Count Display */}
                  <div className="flex flex-col items-center relative z-10">
                    <span className="text-9xl font-black bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-transparent leading-none tracking-tighter filter drop-shadow-2xl">
                        {whistleCount}
                    </span>
                    <span className="text-zinc-500 font-bold uppercase tracking-[0.2em] text-xs mt-4">
                        Target: {targetWhistles}
                    </span>
                  </div>

                  {/* Volume Mini-Bar (Subtle) */}
                  <div className="absolute bottom-12 w-24 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-white/50 transition-all duration-75"
                        style={{ width: `${Math.min(volumeLevel, 100)}%` }}
                      />
                  </div>
               </div>

               {/* Status Pill */}
               <div className="absolute -bottom-4 left-1/2 -translate-x-1/2">
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold border backdrop-blur-md shadow-lg ${getStatusColor()} transition-colors duration-300`}>
                      <div className={`w-2 h-2 rounded-full ${status === 'Listening' ? 'bg-emerald-400 animate-pulse' : 'bg-current'}`} />
                      {getStatusText()}
                  </div>
               </div>
            </div>

            {/* Main Controls */}
            <div className="w-full grid grid-cols-2 gap-4">
                {!isListening ? (
                    <button 
                        onClick={startListening}
                        className="col-span-2 group relative overflow-hidden bg-white text-black font-bold py-5 rounded-2xl flex justify-center items-center gap-3 transition-all active:scale-[0.98] shadow-xl hover:shadow-2xl hover:shadow-white/10"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-violet-200 via-white to-emerald-100 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                        <span className="relative z-10 flex items-center gap-2">
                           <Play fill="currentColor" size={20} /> Start Listening
                        </span>
                    </button>
                ) : (
                    <>
                    <button 
                        onClick={stopListening}
                        className="col-span-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold py-5 rounded-2xl flex justify-center items-center gap-2 transition-all border border-red-500/20 active:scale-95"
                    >
                        <Square fill="currentColor" size={18} /> Stop
                    </button>
                    <button 
                        onClick={resetApp}
                        className="col-span-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold py-5 rounded-2xl transition-all active:scale-95 border border-white/5"
                    >
                        Reset
                    </button>
                    </>
                )}
            </div>

             {/* Debug/Info Info (Subtle) */}
             <div className="mt-8 flex justify-between w-full px-2 text-[10px] text-zinc-600 font-mono">
                <span>Vol: {Math.round(volumeLevel)}</span>
                <span>Thresh: {100 - sensitivity}</span>
            </div>
        </div>

      </div>

      {/* Settings Modal (Slide Up) */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setShowSettings(false)} />
            
            {/* Card */}
            <div className="relative w-full max-w-lg bg-zinc-900/95 border border-white/10 rounded-t-3xl sm:rounded-3xl p-8 shadow-2xl animate-in slide-in-from-bottom-10 duration-300">
                
                <div className="flex justify-between items-center mb-8">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Settings size={20} className="text-violet-400" /> Configuration
                    </h3>
                    <button onClick={() => setShowSettings(false)} className="p-2 bg-white/5 rounded-full hover:bg-white/10 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-8 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
                    
                    {/* Target Selector */}
                    <div>
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-4 block">Target Whistles</label>
                        <div className="flex gap-3">
                            {[1, 2, 3, 4, 5, 8, 10].map(num => (
                                <button 
                                    key={num}
                                    onClick={() => setTargetWhistles(num)}
                                    className={`flex-1 aspect-square sm:aspect-auto sm:py-3 rounded-xl font-bold transition-all border ${
                                        targetWhistles === num 
                                        ? 'bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-900/50 scale-105' 
                                        : 'bg-zinc-800 border-transparent text-zinc-400 hover:bg-zinc-700'
                                    }`}
                                >
                                    {num}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Sliders Group */}
                    <div className="grid gap-6 p-5 bg-white/5 rounded-2xl border border-white/5">
                        {/* Sensitivity */}
                        <div>
                            <div className="flex justify-between mb-3">
                                <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                                    <Volume2 size={16} className="text-emerald-400" /> Mic Sensitivity
                                </label>
                                <span className="text-xs font-mono text-zinc-500">{sensitivity}%</span>
                            </div>
                            <input 
                                type="range" min="1" max="95" 
                                value={sensitivity} 
                                onChange={(e) => setSensitivity(Number(e.target.value))}
                                className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400"
                            />
                        </div>

                        {/* Duration */}
                        <div>
                            <div className="flex justify-between mb-3">
                                <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                                    <Clock size={16} className="text-amber-400" /> Min Duration
                                </label>
                                <span className="text-xs font-mono text-zinc-500">{minDuration}s</span>
                            </div>
                            <input 
                                type="range" min="0.5" max="5.0" step="0.5"
                                value={minDuration} 
                                onChange={(e) => setMinDuration(Number(e.target.value))}
                                className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500 hover:accent-amber-400"
                            />
                        </div>
                    </div>

                    {/* Integrations */}
                    <div className="space-y-4">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider block">Integrations</label>
                        
                        <div className="relative group">
                            <Wifi size={16} className={`absolute left-4 top-4 transition-colors ${alexaUrl ? 'text-cyan-400' : 'text-zinc-600'}`} />
                            <input 
                                type="text" 
                                placeholder="Alexa Webhook (IFTTT)"
                                value={alexaUrl} 
                                onChange={(e) => setAlexaUrl(e.target.value)}
                                className="w-full bg-zinc-800/50 border border-white/5 focus:border-cyan-500/50 rounded-xl py-3 pl-12 pr-4 text-sm text-zinc-200 focus:outline-none transition-all focus:bg-zinc-800"
                            />
                        </div>

                        <div className="relative group">
                            <MessageCircle size={16} className={`absolute left-4 top-4 transition-colors ${whatsappUrl ? 'text-green-400' : 'text-zinc-600'}`} />
                            <input 
                                type="text" 
                                placeholder="WhatsApp URL (CallMeBot)"
                                value={whatsappUrl} 
                                onChange={(e) => setWhatsappUrl(e.target.value)}
                                className="w-full bg-zinc-800/50 border border-white/5 focus:border-green-500/50 rounded-xl py-3 pl-12 pr-4 text-sm text-zinc-200 focus:outline-none transition-all focus:bg-zinc-800"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Toast Error */}
      {errorMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white text-sm py-2 px-4 rounded-full shadow-xl backdrop-blur-md flex items-center gap-2 animate-in slide-in-from-top-2">
            <AlertCircle size={16} /> {errorMessage}
        </div>
      )}

    </div>
  );
}