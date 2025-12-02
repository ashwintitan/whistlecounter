import React, { useState, useEffect, useRef } from 'react';
import { Mic, Settings, Play, Square, AlertTriangle, Wifi, Info, MessageCircle, Clock } from 'lucide-react';

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
    // e.g., 2.0s * 60 = 120 frames
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

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-4 font-sans">
      
      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-8 pt-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
            <Mic className="text-blue-400" />
            Whistle<span className="text-blue-400">Counter</span>
        </h1>
        <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-full transition ${showSettings ? 'bg-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}
        >
            <Settings size={20} />
        </button>
      </div>

      {/* Main Display */}
      <div className="w-full max-w-md bg-slate-800 rounded-3xl p-8 shadow-2xl border border-slate-700 relative overflow-hidden">
        
        <div className={`absolute top-0 left-0 w-full h-1.5 
            ${status === 'Listening' ? 'bg-green-500 animate-pulse' : 
              status === 'Cooldown' ? 'bg-yellow-500' : 
              status === 'Triggered' ? 'bg-red-500' : 'bg-slate-600'}`} 
        />

        <div className="text-center mb-8">
            <span className="text-slate-400 text-sm uppercase tracking-wider font-semibold">{status}</span>
            <div className="mt-4 flex justify-center items-end gap-2">
                <span className="text-8xl font-black tracking-tighter text-white">
                    {whistleCount}
                </span>
                <span className="text-3xl font-medium text-slate-500 mb-4">/ {targetWhistles}</span>
            </div>
            <p className="text-slate-400 mt-2">Whistles Detected</p>
        </div>

        {/* Visualizer Bar */}
        <div className="w-full h-8 bg-slate-900 rounded-full mb-8 overflow-hidden relative border border-slate-700">
            {/* The Volume Level Bar */}
            <div 
                className="h-full bg-gradient-to-r from-green-500 to-red-500 transition-all duration-75 ease-out"
                style={{ width: `${Math.min(volumeLevel, 100)}%` }}
            />
            
            {/* The Threshold Marker Line */}
            <div 
                className="absolute top-0 bottom-0 w-1 bg-white z-10 shadow-[0_0_10px_rgba(255,255,255,0.8)]"
                style={{ left: `${100 - sensitivity}%` }}
            />
        </div>
        <div className="flex justify-between text-xs text-slate-500 mb-8 -mt-6 px-1 font-mono">
            <span>Quiet</span>
            {/* DEBUG DISPLAY: Shows exact numbers */}
            <span className={`font-bold transition-colors ${volumeLevel > (100-sensitivity) ? 'text-green-400' : 'text-slate-400'}`}>
                Current: {Math.round(volumeLevel)} | Trigger: {100 - sensitivity}
            </span>
            <span>Loud</span>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-2 gap-4">
            {!isListening ? (
                <button 
                    onClick={startListening}
                    className="col-span-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-900/50"
                >
                    <Play fill="currentColor" /> Start Listening
                </button>
            ) : (
                <button 
                    onClick={stopListening}
                    className="col-span-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all border border-red-500/50"
                >
                    <Square fill="currentColor" size={18} /> Stop
                </button>
            )}
            
            {isListening && (
                 <button 
                 onClick={resetApp}
                 className="col-span-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-4 rounded-xl transition-all"
             >
                 Reset
             </button>
            )}
        </div>
      </div>

      {/* Settings / Instructions Panel */}
      {showSettings && (
        <div className="w-full max-w-md mt-6 bg-slate-800 rounded-2xl p-6 border border-slate-700 animate-in slide-in-from-bottom-5 mb-10">
            <h3 className="font-bold text-lg mb-6 flex items-center gap-2 border-b border-slate-700 pb-2">
                <Settings size={18} /> Configuration
            </h3>

            {/* Target Input */}
            <div className="mb-6">
                <label className="block text-sm text-slate-400 mb-2">Target Whistles</label>
                <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map(num => (
                        <button 
                            key={num}
                            onClick={() => setTargetWhistles(num)}
                            className={`flex-1 py-2 rounded-lg font-bold ${targetWhistles === num ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
                        >
                            {num}
                        </button>
                    ))}
                </div>
            </div>

            {/* Sensitivity Input */}
            <div className="mb-6">
                <label className="block text-sm text-slate-400 mb-2 flex justify-between">
                    <span>Mic Sensitivity</span>
                    <span>{sensitivity}%</span>
                </label>
                <input 
                    type="range" 
                    min="1" 
                    max="95" 
                    value={sensitivity} 
                    onChange={(e) => setSensitivity(Number(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
            </div>

            {/* Duration Input */}
            <div className="mb-6">
                <label className="block text-sm text-slate-400 mb-2 flex justify-between">
                    <span className="flex items-center gap-2"><Clock size={14} /> Min Whistle Duration</span>
                    <span>{minDuration}s</span>
                </label>
                <input 
                    type="range" 
                    min="0.5" 
                    max="5.0" 
                    step="0.5"
                    value={minDuration} 
                    onChange={(e) => setMinDuration(Number(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                />
                <p className="text-xs text-slate-500 mt-2">
                    Sound must be continuous for this long to count.
                </p>
            </div>

            {/* Alexa Input */}
            <div className="mb-6">
                <label className="block text-sm text-slate-400 mb-2 flex items-center gap-2">
                    <Wifi size={14} className="text-cyan-400" /> Alexa Webhook (IFTTT)
                </label>
                <input 
                    type="text" 
                    placeholder="https://maker.ifttt.com/trigger/..."
                    value={alexaUrl} 
                    onChange={(e) => setAlexaUrl(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                />
            </div>

            {/* WhatsApp Input */}
            <div className="mb-4">
                <label className="block text-sm text-slate-400 mb-2 flex items-center gap-2">
                    <MessageCircle size={14} className="text-green-400" /> WhatsApp URL (CallMeBot)
                </label>
                <input 
                    type="text" 
                    placeholder="https://api.callmebot.com/whatsapp.php?..."
                    value={whatsappUrl} 
                    onChange={(e) => setWhatsappUrl(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-green-500"
                />
            </div>
            
        </div>
      )}

      {errorMessage && (
        <div className="mt-4 p-3 bg-red-500/20 border border-red-500 text-red-200 rounded-lg flex items-center gap-2">
            <AlertTriangle size={18} /> {errorMessage}
        </div>
      )}

    </div>
  );
}