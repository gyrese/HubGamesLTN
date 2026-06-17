import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Palette, MonitorPlay, Smartphone, ArrowRight, ArrowLeft } from 'lucide-react';
import { hsbToCss } from '../../components/Color/ColorSilhouettes';
import '../../components/Color/ColorStyles.css';

/**
 * Slowly cycles the live accent color through the hue spectrum so the whole
 * entry screen subtly breathes color — a quiet nod to the game itself.
 * Honors prefers-reduced-motion (locks to the brand amber).
 */
function useHueCycle(enabled) {
    const [hue, setHue] = useState(38); // start near amber
    useEffect(() => {
        if (!enabled) return;
        const id = setInterval(() => setHue((h) => (h + 1.2) % 360), 90);
        return () => clearInterval(id);
    }, [enabled]);
    return hue;
}

function ColorSelectPage() {
    const navigate = useNavigate();
    const reduce = useReducedMotion();
    const hue = useHueCycle(!reduce);
    const live = reduce ? '#f59e0b' : hsbToCss(hue, 82, 96);

    const enter = {
        hidden: { opacity: 0, y: 18 },
        show: (i) => ({
            opacity: 1, y: 0,
            transition: { type: 'spring', stiffness: 120, damping: 16, delay: 0.06 * i },
        }),
    };

    return (
        <div
            className="cm-root cm-scroll relative w-full h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-10 select-none"
            style={{ '--live': live, '--live-ink': '#0c0a07' }}
        >
            <div className="cm-bg-grid" />
            <div
                className="cm-bg-pool"
                style={{ background: `radial-gradient(60% 50% at 50% 8%, ${live}26, transparent 70%)` }}
            />

            {/* Back */}
            <button
                onClick={() => navigate('/')}
                className="cm-icon-btn absolute top-5 left-5 h-10 px-3.5 gap-2 text-sm z-10"
            >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Accueil</span>
            </button>

            <main className="relative z-10 w-full max-w-md flex flex-col items-center text-center">
                {/* Brand mark */}
                <motion.div
                    custom={0} variants={enter} initial="hidden" animate="show"
                    className="cm-glass w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
                    style={{ boxShadow: `0 18px 50px -22px ${live}` }}
                >
                    <Palette className="w-7 h-7" style={{ color: live }} />
                </motion.div>

                <motion.h1
                    custom={1} variants={enter} initial="hidden" animate="show"
                    className="text-[clamp(2.6rem,11vw,3.6rem)] font-bold leading-[0.95] tracking-[-0.03em] text-balance"
                >
                    Couleur <span style={{ color: live, transition: 'color .2s linear' }}>Moi</span>
                </motion.h1>

                <motion.p
                    custom={2} variants={enter} initial="hidden" animate="show"
                    className="mt-4 text-[15px] leading-relaxed text-[var(--cm-ink-2)] max-w-sm"
                >
                    Recrée la couleur exacte de personnages cultes. Le plus précis gagne.
                </motion.p>

                {/* Actions */}
                <motion.div
                    custom={3} variants={enter} initial="hidden" animate="show"
                    className="mt-9 w-full flex flex-col gap-3"
                >
                    <button
                        onClick={() => navigate('/color/host')}
                        className="cm-btn cm-btn-primary group w-full p-4 justify-start gap-4"
                    >
                        <span className="w-11 h-11 rounded-xl grid place-items-center bg-black/15 shrink-0">
                            <MonitorPlay className="w-5 h-5" />
                        </span>
                        <span className="flex flex-col items-start leading-tight">
                            <span className="text-base font-semibold">Créer une partie</span>
                            <span className="text-xs font-medium opacity-70">Sur grand écran, en tant qu'hôte</span>
                        </span>
                        <ArrowRight className="w-5 h-5 ml-auto transition-transform duration-200 group-hover:translate-x-1" />
                    </button>

                    <button
                        onClick={() => navigate('/color/play')}
                        className="cm-btn cm-btn-ghost group w-full p-4 justify-start gap-4"
                    >
                        <span className="w-11 h-11 rounded-xl grid place-items-center bg-white/5 shrink-0">
                            <Smartphone className="w-5 h-5" style={{ color: live }} />
                        </span>
                        <span className="flex flex-col items-start leading-tight">
                            <span className="text-base font-semibold">Rejoindre une partie</span>
                            <span className="text-xs font-medium text-[var(--cm-faint)]">Sur ton téléphone, avec un code</span>
                        </span>
                        <ArrowRight className="w-5 h-5 ml-auto transition-transform duration-200 group-hover:translate-x-1" />
                    </button>
                </motion.div>
            </main>
        </div>
    );
}

export default ColorSelectPage;
