import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../../components/FakeArtist/FakeArtistStyles.css';

function FakeArtistSelectPage() {
    const navigate = useNavigate();

    useEffect(() => {
        document.body.classList.add('fa-noir');
        return () => document.body.classList.remove('fa-noir');
    }, []);

    return (
        <div className="fa-app min-h-screen flex items-center justify-center p-6 select-none overflow-hidden">
            {/* Halos d'ambiance */}
            <div className="fa-orb fa-orb-a" style={{ width: 420, height: 420, top: '-10%', left: '-8%' }} />
            <div className="fa-orb fa-orb-r" style={{ width: 380, height: 380, bottom: '-12%', right: '-6%' }} />

            <main className="w-full max-w-[460px] relative z-10">
                {/* Titre */}
                <div className="text-center mb-9">
                    <div className="fa-label mb-4">Dossier n° 07 · Bureau des faussaires</div>

                    <h1 className="fa-h text-[3.25rem] leading-none mb-4">
                        <span className="fa-title-glow">Fake</span>{' '}
                        <span className="text-[var(--fa-text)]">Artist</span>
                    </h1>

                    <p className="text-[0.9375rem] fa-text-muted leading-relaxed max-w-[340px] mx-auto">
                        Un dessin, un trait chacun.
                        <br />
                        L'un de vous ignore ce qu'il dessine.
                    </p>
                </div>

                {/* Actions */}
                <div className="fa-card p-6 fa-stagger flex flex-col gap-3">
                    <button
                        onClick={() => navigate('/fakeartist/host')}
                        className="fa-btn fa-btn-primary fa-btn-lg w-full"
                    >
                        <span className="material-symbols-outlined text-[20px]">cast</span>
                        Ouvrir une table
                    </button>

                    <button
                        onClick={() => navigate('/fakeartist/play')}
                        className="fa-btn fa-btn-lg w-full"
                    >
                        <span className="material-symbols-outlined text-[20px]">smartphone</span>
                        Rejoindre avec un code
                    </button>

                    <div className="flex items-center gap-3 pt-2">
                        <div className="h-px flex-1 bg-[var(--fa-line)]" />
                        <span className="fa-label !text-[0.625rem]">3 à 12 joueurs</span>
                        <div className="h-px flex-1 bg-[var(--fa-line)]" />
                    </div>

                    {/* Règle en trois temps */}
                    <div className="grid grid-cols-3 gap-2.5 text-center">
                        {[
                            { n: '01', t: 'Dessinez', d: 'Un seul trait, chacun son tour' },
                            { n: '02', t: 'Débattez', d: 'Qui hésite ? Qui copie ?' },
                            { n: '03', t: 'Votez', d: 'Démasquez le faussaire' }
                        ].map(step => (
                            <div key={step.n} className="fa-card-inset p-3">
                                <div className="fa-mono text-[0.6875rem] fa-text-amber mb-1.5">{step.n}</div>
                                <div className="text-[0.8125rem] font-bold mb-1">{step.t}</div>
                                <div className="text-[0.6875rem] fa-text-dim leading-snug">{step.d}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <button
                    onClick={() => navigate('/')}
                    className="fa-btn fa-btn-ghost fa-btn-sm mx-auto mt-7 flex"
                >
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                    Retour au hub
                </button>
            </main>
        </div>
    );
}

export default FakeArtistSelectPage;
