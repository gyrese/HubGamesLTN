import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Brain, MonitorPlay, Smartphone, ArrowRight, ArrowLeft } from 'lucide-react';
import '../../components/Quiz/QuizStyles.css';

function QuizSelectPage() {
    const navigate = useNavigate();

    const enter = {
        hidden: { opacity: 0, y: 18 },
        show: (i) => ({
            opacity: 1, y: 0,
            transition: { type: 'spring', stiffness: 120, damping: 16, delay: 0.06 * i },
        }),
    };

    return (
        <div className="nq-root nq-scroll relative w-full h-[100dvh] overflow-y-auto flex flex-col items-center justify-center px-5 py-10 select-none">
            <div className="nq-bg-grid" />
            <div className="nq-bg-pool" />

            <button
                onClick={() => navigate('/')}
                className="nq-icon-btn absolute top-5 left-5 h-10 px-3.5 gap-2 text-sm z-10"
            >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Accueil</span>
            </button>

            <main className="relative z-10 w-full max-w-md flex flex-col items-center text-center">
                <motion.div
                    custom={0} variants={enter} initial="hidden" animate="show"
                    className="nq-glass w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
                    style={{ boxShadow: '0 18px 50px -22px var(--nq-accent)' }}
                >
                    <Brain className="w-7 h-7" style={{ color: 'var(--nq-accent)' }} />
                </motion.div>

                <motion.h1
                    custom={1} variants={enter} initial="hidden" animate="show"
                    className="text-[clamp(2.6rem,11vw,3.6rem)] font-bold leading-[0.95] tracking-[-0.03em] text-balance"
                >
                    Test de <span style={{ color: 'var(--nq-accent)' }}>QI</span>
                </motion.h1>

                <motion.p
                    custom={2} variants={enter} initial="hidden" animate="show"
                    className="mt-4 text-[15px] leading-relaxed max-w-sm"
                    style={{ color: 'var(--nq-ink-2)' }}
                >
                    Un quiz de logique multijoueur. Score de QI calculé façon vrai test… et stats absurdes garanties.
                </motion.p>

                <motion.div
                    custom={3} variants={enter} initial="hidden" animate="show"
                    className="mt-9 w-full flex flex-col gap-3"
                >
                    <button
                        onClick={() => navigate('/quiz/host')}
                        className="nq-btn nq-btn-primary group w-full p-4 justify-start gap-4"
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
                        onClick={() => navigate('/quiz/play')}
                        className="nq-btn nq-btn-ghost group w-full p-4 justify-start gap-4"
                    >
                        <span className="w-11 h-11 rounded-xl grid place-items-center bg-white/5 shrink-0">
                            <Smartphone className="w-5 h-5" style={{ color: 'var(--nq-accent)' }} />
                        </span>
                        <span className="flex flex-col items-start leading-tight">
                            <span className="text-base font-semibold">Rejoindre une partie</span>
                            <span className="text-xs font-medium" style={{ color: 'var(--nq-faint)' }}>Sur ton téléphone, avec un code</span>
                        </span>
                        <ArrowRight className="w-5 h-5 ml-auto transition-transform duration-200 group-hover:translate-x-1" />
                    </button>
                </motion.div>
            </main>
        </div>
    );
}

export default QuizSelectPage;
