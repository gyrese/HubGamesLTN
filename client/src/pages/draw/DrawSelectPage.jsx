import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../../components/Draw/DrawStyles.css';

function DrawSelectPage() {
    const navigate = useNavigate();

    useEffect(() => {
        document.body.classList.add('draw-neon');
        return () => document.body.classList.remove('draw-neon');
    }, []);

    return (
        <div className="dr-app h-svh flex items-center justify-center p-6 overflow-hidden select-none"
            style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" /><span className="dr-orb dr-orb-c" />

            <main className="w-full max-w-sm flex flex-col items-center gap-8 dr-fade-up">
                {/* Logo */}
                <div className="flex flex-col items-center text-center gap-4">
                    <div className="dr-logo-mark w-20 h-20">
                        <span className="material-symbols-outlined text-4xl">stylus_note</span>
                    </div>
                    <div>
                        <h1 className="dr-h text-5xl">DRAW <span className="dr-grad-text">ME</span></h1>
                        <p className="dr-eyebrow mt-2">Dessine · Devine · Ris</p>
                    </div>
                </div>

                {/* Choices */}
                <div className="w-full flex flex-col gap-3.5">
                    <button
                        onClick={() => navigate('/draw/host')}
                        className="dr-card dr-card-glow w-full p-5 flex items-center gap-4 text-left transition-transform active:scale-[0.98]"
                    >
                        <div className="dr-logo-mark w-12 h-12 flex-shrink-0">
                            <span className="material-symbols-outlined text-2xl">cast</span>
                        </div>
                        <div className="min-w-0">
                            <div className="dr-h text-lg">Créer une partie</div>
                            <div className="text-xs text-[color:var(--dr-muted)]">Hôte · grand écran / TV</div>
                        </div>
                        <span className="material-symbols-outlined text-[color:var(--dr-violet-lt)] ml-auto">chevron_right</span>
                    </button>

                    <button
                        onClick={() => navigate('/draw/play')}
                        className="dr-card w-full p-5 flex items-center gap-4 text-left transition-transform active:scale-[0.98]"
                    >
                        <div className="w-12 h-12 flex-shrink-0 rounded-xl flex items-center justify-center"
                            style={{ background: 'var(--dr-grad-cyan)', boxShadow: 'var(--dr-glow-c)' }}>
                            <span className="material-symbols-outlined text-2xl text-white">smartphone</span>
                        </div>
                        <div className="min-w-0">
                            <div className="dr-h text-lg">Rejoindre une partie</div>
                            <div className="text-xs text-[color:var(--dr-muted)]">Sur ton téléphone</div>
                        </div>
                        <span className="material-symbols-outlined text-[color:var(--dr-cyan)] ml-auto">chevron_right</span>
                    </button>
                </div>

                <button
                    onClick={() => navigate('/')}
                    className="dr-btn dr-btn-ghost py-2.5 text-sm"
                >
                    <span className="material-symbols-outlined text-base">arrow_back</span>
                    Menu principal
                </button>
            </main>
        </div>
    );
}

export default DrawSelectPage;
