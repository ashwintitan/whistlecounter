import React, { useState, useEffect, useRef } from 'react';
import { Mic, Settings, Play, Square, X, Wifi, MessageCircle, Clock, Volume2, Check, AlertCircle, ChevronRight } from 'lucide-react';

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

  // --- UI CONSTANTS ---
  // Circumference for the SVG circle (r=120) -> 2 * pi * 120 ≈ 754
  const CIRCLE_CIRCUMFERENCE = 754; 
  const volumeOffset = CIRCLE_CIRCUMFERENCE - (Math.min(volumeLevel, 100) / 100) * CIRCLE_CIRCUMFERENCE;
  // Calculate where the threshold marker should be (0 to 100%)
  const thresholdPercent = 100 - sensitivity;
  // Convert threshold percent to rotation degrees (starts at -90deg)
  const thresholdRotation = (thresholdPercent / 100) * 360;

  return (
    <div className="min-h-[100dvh] bg-neutral-950 text-neutral-100 font-sans selection:bg-orange-500/30 flex flex-col">
      
      {/* --- Header --- */}
      <header className="px-6 py-6 flex justify-between items-center z-10">
         <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-orange-500 shadow-lg">
                <Mic size={20} strokeWidth={2.5} />
            </div>
            <div>
                <h1 className="text-lg font-bold leading-none tracking-tight">Whistle<span className="text-orange-500">Count</span></h1>
                <p className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mt-1">Pro Edition</p>
            </div>
         </div>
         <button 
            onClick={() => setShowSettings(true)}
            className="w-10 h-10 rounded-full hover:bg-neutral-900 flex items-center justify-center transition-colors text-neutral-400 hover:text-white"
         >
            <Settings size={22} />
         </button>
      </header>

      {/* --- Main Display --- */}
      <main className="flex-1 flex flex-col items-center justify-center relative p-6">
         
         {/* Circular Visualizer */}
         <div className="relative w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center mb-10">
            
            {/* Background Track */}
            <svg className="absolute inset-0 w-full h-full rotate-[-90deg]">
               <circle cx="50%" cy="50%" r="46%" fill="none" stroke="#262626" strokeWidth="12" strokeLinecap="round" />
            </svg>

            {/* Volume Fill Ring */}
            <svg className="absolute inset-0 w-full h-full rotate-[-90deg] transition-all duration-100 ease-linear">
               <circle 
                  cx="50%" cy="50%" r="46%" fill="none" 
                  stroke={status === 'Triggered' ? '#ef4444' : '#f97316'} 
                  strokeWidth="12" 
                  strokeLinecap="round"
                  strokeDasharray={CIRCLE_CIRCUMFERENCE}
                  strokeDashoffset={volumeOffset}
                  className="drop-shadow-[0_0_15px_rgba(249,115,22,0.3)]"
               />
            </svg>

            {/* Threshold Marker (Visual Guide) */}
            <div 
                className="absolute w-full h-full pointer-events-none"
                style={{ transform: `rotate(${thresholdRotation}deg)` }}
            >
                {/* The marker tick */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 w-1 h-5 bg-white shadow-[0_0_10px_white] rounded-full z-10" />
            </div>

            {/* Central Info */}
            <div className="relative z-20 flex flex-col items-center text-center">
                <div className="text-neutral-500 text-xs font-bold uppercase tracking-widest mb-2">
                    {status === 'Triggered' ? 'Done' : `Whistle ${Math.min(whistleCount + 1, targetWhistles)}`}
                </div>
                <div className="text-8xl font-bold tracking-tighter text-white tabular-nums leading-none">
                    {whistleCount}
                </div>
                <div className="text-neutral-600 font-medium text-sm mt-2">
                   of <span className="text-neutral-400">{targetWhistles}</span> target
                </div>
            </div>
         </div>

         {/* Status Text */}
         <div className="text-center h-12 mb-4">
             {status === 'Ready' && <p className="text-neutral-400 text-lg">Tap Start to begin monitoring</p>}
             {status === 'Listening' && <p className="text-emerald-400 font-medium animate-pulse flex items-center gap-2 justify-center"><span className="w-2 h-2 bg-emerald-400 rounded-full"/> Listening for sound...</p>}
             {status === 'Cooldown' && <p className="text-amber-400 font-medium flex items-center gap-2 justify-center"><Clock size={16}/> Cooling down (5s)...</p>}
             {status === 'Triggered' && <p className="text-red-500 font-bold text-xl animate-bounce">ALARM TRIGGERED!</p>}
         </div>

      </main>

      {/* --- Footer / Controls --- */}
      <footer className="p-6 bg-neutral-900/50 backdrop-blur-md border-t border-white/5 pb-8 sm:pb-6">
         {!isListening ? (
             <button 
                onClick={startListening}
                className="w-full bg-orange-500 hover:bg-orange-400 text-black font-bold text-lg h-16 rounded-2xl shadow-[0_0_40px_-10px_rgba(249,115,22,0.4)] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
             >
                <Play fill="currentColor" size={24} /> Start Monitoring
             </button>
         ) : (
             <div className="grid grid-cols-3 gap-3">
                <button 
                    onClick={stopListening}
                    className="col-span-2 bg-neutral-800 hover:bg-neutral-700 text-white font-bold h-16 rounded-2xl border border-white/5 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                    <Square fill="currentColor" size={20} /> Stop
                </button>
                <button 
                    onClick={resetApp}
                    className="col-span-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white font-semibold h-16 rounded-2xl border border-white/5 active:scale-[0.98] transition-all"
                >
                    Reset
                </button>
             </div>
         )}
      </footer>

      {/* --- Settings Modal --- */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={() => setShowSettings(false)} />
            
            <div className="relative w-full max-w-md bg-neutral-900 border-t sm:border border-neutral-800 rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom-10 duration-300 max-h-[85vh] overflow-y-auto">
                
                <div className="flex justify-between items-center mb-8 sticky top-0 bg-neutral-900 z-10 py-2">
                    <h2 className="text-xl font-bold text-white">Settings</h2>
                    <button onClick={() => setShowSettings(false)} className="p-2 bg-neutral-800 rounded-full hover:bg-neutral-700 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-8">
                    {/* Target */}
                    <section>
                        <div className="flex justify-between items-center mb-4">
                            <label className="text-sm font-semibold text-neutral-300">Target Count</label>
                            <span className="text-xs font-bold bg-neutral-800 px-2 py-1 rounded text-orange-500">{targetWhistles} whistles</span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                            {[1, 2, 3, 4, 5, 8, 10].map(num => (
                                <button 
                                    key={num}
                                    onClick={() => setTargetWhistles(num)}
                                    className={`flex-none w-12 h-12 rounded-xl font-bold transition-all border ${
                                        targetWhistles === num 
                                        ? 'bg-orange-500 border-orange-400 text-black shadow-lg scale-105' 
                                        : 'bg-neutral-800 border-transparent text-neutral-400 hover:bg-neutral-700'
                                    }`}
                                >
                                    {num}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Sensitivity */}
                    <section className="bg-neutral-800/50 p-4 rounded-2xl border border-white/5">
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center gap-2">
                                <Volume2 size={18} className="text-orange-400" />
                                <span className="text-sm font-semibold">Sensitivity</span>
                            </div>
                            <span className="text-xs text-neutral-400">{sensitivity}%</span>
                        </div>
                        <input 
                            type="range" min="1" max="95" 
                            value={sensitivity} 
                            onChange={(e) => setSensitivity(Number(e.target.value))}
                            className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                        />
                        <p className="text-[10px] text-neutral-500 mt-2 text-right">Higher = Easier to trigger</p>
                    </section>

                    {/* Duration */}
                    <section className="bg-neutral-800/50 p-4 rounded-2xl border border-white/5">
                         <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center gap-2">
                                <Clock size={18} className="text-blue-400" />
                                <span className="text-sm font-semibold">Duration</span>
                            </div>
                            <span className="text-xs text-neutral-400">{minDuration}s</span>
                        </div>
                        <input 
                            type="range" min="0.5" max="5.0" step="0.5"
                            value={minDuration} 
                            onChange={(e) => setMinDuration(Number(e.target.value))}
                            className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                         <p className="text-[10px] text-neutral-500 mt-2 text-right">Hold sound this long to count</p>
                    </section>

                    {/* Webhooks */}
                    <section className="space-y-3 pt-2 border-t border-neutral-800">
                        <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Automations</h3>
                        
                        <div className="flex items-center gap-3 bg-neutral-800/30 p-3 rounded-xl border border-white/5">
                            <Wifi size={18} className={alexaUrl ? "text-cyan-400" : "text-neutral-600"} />
                            <input 
                                type="text" 
                                placeholder="Alexa Webhook URL..."
                                value={alexaUrl} 
                                onChange={(e) => setAlexaUrl(e.target.value)}
                                className="flex-1 bg-transparent text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none"
                            />
                            {alexaUrl && <Check size={16} className="text-emerald-500" />}
                        </div>

                        <div className="flex items-center gap-3 bg-neutral-800/30 p-3 rounded-xl border border-white/5">
                            <MessageCircle size={18} className={whatsappUrl ? "text-green-400" : "text-neutral-600"} />
                            <input 
                                type="text" 
                                placeholder="WhatsApp URL..."
                                value={whatsappUrl} 
                                onChange={(e) => setWhatsappUrl(e.target.value)}
                                className="flex-1 bg-transparent text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none"
                            />
                             {whatsappUrl && <Check size={16} className="text-emerald-500" />}
                        </div>
                    </section>
                </div>
            </div>
        </div>
      )}

      {/* Error Toast */}
      {errorMessage && (
        <div className="fixed top-4 left-4 right-4 bg-red-500/10 border border-red-500/50 text-red-200 text-sm p-4 rounded-xl backdrop-blur-md flex items-center gap-3 animate-in slide-in-from-top-2 z-50">
            <AlertCircle size={20} className="shrink-0" />
            <span className="font-medium">{errorMessage}</span>
        </div>
      )}

    </div>
  );
}