import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SCENE_DURATIONS = {
  scene1: 5000,
  scene2: 7000,
  scene3: 5000,
  scene4: 3000,
};

export default function AdVideoTemplate() {
  const [currentScene, setCurrentScene] = useState(0);

  // Parse URL search params
  const searchParams = new URLSearchParams(window.location.search);
  const headline = searchParams.get('headline') || 'Never Miss a Lead — Even After Hours!';
  const body = searchParams.get('body') || "Running a business doesn't stop at 5pm. With our conversational AI receptionist, your customers always reach a helpful, professional response — no matter the time.";
  const cta = searchParams.get('cta') || 'Try FREE — Start Today';

  useEffect(() => {
    const durations = Object.values(SCENE_DURATIONS);
    const currentDuration = durations[currentScene];

    const timer = setTimeout(() => {
      setCurrentScene((prev) => (prev + 1) % durations.length);
    }, currentDuration);

    return () => clearTimeout(timer);
  }, [currentScene]);

  // Make sure Google fonts are loaded
  useEffect(() => {
    if (!document.getElementById('video-fonts')) {
      const link = document.createElement('link');
      link.id = 'video-fonts';
      link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&family=Inter:wght@400;500;600&display=swap';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="w-full h-screen bg-[#0a0c10] flex items-center justify-center overflow-hidden">
      <div 
        className="relative bg-gradient-to-br from-[#0f1117] to-[#1a1f2e] overflow-hidden shadow-2xl"
        style={{
          width: '1080px',
          height: '1080px',
          transform: 'scale(min(calc(100vw / 1080), calc(100vh / 1080)))',
          transformOrigin: 'center center',
          fontFamily: "'Inter', sans-serif"
        }}
      >
        {/* Background ambient animations */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div 
            className="absolute w-[800px] h-[800px] rounded-full opacity-20 blur-[120px]"
            style={{ background: 'radial-gradient(circle, #3b82f6, transparent)' }}
            animate={{ 
              x: ['-20%', '40%', '-10%'], 
              y: ['10%', '-20%', '30%'],
              scale: [1, 1.2, 0.9]
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          />
          <motion.div 
            className="absolute right-0 bottom-0 w-[600px] h-[600px] rounded-full opacity-20 blur-[100px]"
            style={{ background: 'radial-gradient(circle, #06b6d4, transparent)' }}
            animate={{ 
              x: ['10%', '-30%', '20%'], 
              y: ['-10%', '-40%', '10%']
            }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
          />
        </div>

        <AnimatePresence mode="popLayout">
          {currentScene === 0 && <Scene1 key="scene1" headline={headline} />}
          {currentScene === 1 && <Scene2 key="scene2" body={body} />}
          {currentScene === 2 && <Scene3 key="scene3" />}
          {currentScene === 3 && <Scene4 key="scene4" cta={cta} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Scene1({ headline }: { headline: string }) {
  const words = headline.split(' ');

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-20 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 0.8 }}
    >
      <h1 
        className="text-[90px] font-extrabold text-white leading-tight tracking-tight flex flex-wrap justify-center gap-x-6 gap-y-4"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {words.map((word, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 50, rotateX: 45 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ delay: i * 0.15 + 0.2, type: "spring", stiffness: 200, damping: 20 }}
            className="inline-block"
          >
            {word}
          </motion.span>
        ))}
      </h1>
      
      <motion.div 
        className="w-1/3 h-2 bg-gradient-to-r from-transparent via-[#3b82f6] to-transparent mt-12 shadow-[0_0_20px_#06b6d4]"
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ delay: words.length * 0.15 + 0.5, duration: 1, ease: "circOut" }}
      />
    </motion.div>
  );
}

function Scene2({ body }: { body: string }) {
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowText(true), 500);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center p-24"
      initial={{ opacity: 0, x: -100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, y: -100 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {/* Dot Grid Background */}
      <motion.div 
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'radial-gradient(#3b82f6 2px, transparent 2px)',
          backgroundSize: '40px 40px'
        }}
        initial={{ scale: 1.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.15 }}
        transition={{ duration: 6, ease: "linear" }}
      />

      <p className="text-[64px] font-medium text-[#e2e8f0] leading-relaxed text-center relative z-10">
        {body.split('. ').map((sentence, i) => (
          <motion.span
            key={i}
            className="block mb-8"
            initial={{ opacity: 0, filter: 'blur(10px)', y: 20 }}
            animate={showText ? { opacity: 1, filter: 'blur(0px)', y: 0 } : { opacity: 0, filter: 'blur(10px)', y: 20 }}
            transition={{ delay: i * 1.5, duration: 1 }}
          >
            {sentence}{sentence.endsWith('.') ? '' : '.'}
          </motion.span>
        ))}
      </p>
    </motion.div>
  );
}

function Scene3() {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center gap-16"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.2 }}
      transition={{ duration: 0.8 }}
    >
      <StatItem delay={0.2} label="Available" value="24/7" />
      <StatItem delay={1.2} label="Missed Calls" value="0" />
      <StatItem delay={2.2} label="Leads Captured" value="∞" glow />
    </motion.div>
  );
}

function StatItem({ delay, label, value, glow = false }: { delay: number, label: string, value: string, glow?: boolean }) {
  return (
    <motion.div 
      className="flex flex-col items-center"
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 150, damping: 15 }}
    >
      <motion.span 
        className={`text-[120px] font-black leading-none ${glow ? 'text-[#06b6d4]' : 'text-[#3b82f6]'}`}
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: delay + 0.2, type: "spring", bounce: 0.5 }}
      >
        {value}
      </motion.span>
      <span className="text-[40px] font-semibold text-white/80 tracking-widest uppercase mt-4">
        {label}
      </span>
    </motion.div>
  );
}

function Scene4({ cta }: { cta: string }) {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-20"
      initial={{ opacity: 0, filter: 'blur(20px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.8 }}
        className="mb-20 text-center"
      >
        <span 
          className="text-[60px] font-bold text-white tracking-wider uppercase flex items-center justify-center gap-6"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          <div className="w-16 h-16 rounded-xl bg-[#3b82f6] shadow-[0_0_30px_#3b82f6]" />
          WEEBEE VOICE
        </span>
      </motion.div>

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 1, type: "spring", bounce: 0.5 }}
      >
        <div className="relative group">
          <div className="absolute inset-0 bg-[#06b6d4] rounded-full blur-xl opacity-50 group-hover:opacity-100 transition-opacity duration-500 animate-pulse" />
          <div className="relative px-20 py-8 bg-gradient-to-r from-[#3b82f6] to-[#06b6d4] rounded-full border border-white/20">
            <span className="text-[50px] font-bold text-white tracking-wide">
              {cta}
            </span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
