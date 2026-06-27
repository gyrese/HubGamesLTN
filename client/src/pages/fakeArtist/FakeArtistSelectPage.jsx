import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function FakeArtistSelectPage() {
    const navigate = useNavigate();

    useEffect(() => {
        document.body.classList.add('comic-theme');
        return () => document.body.classList.remove('comic-theme');
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center p-6 text-on-background font-body-md relative select-none overflow-hidden">

            {/* Mots d'action flottants style BD */}
            <div className="absolute top-10 left-6 bg-[#FF3B30] text-white font-black text-2xl uppercase italic px-4 py-2 border-[3px] border-on-background shadow-[4px_4px_0_#1a1a1a] -rotate-12 select-none z-0">
                IMPOSTEUR ?
            </div>
            <div className="absolute top-16 right-6 bg-[#FFD60A] text-on-background font-black text-2xl uppercase italic px-4 py-2 border-[3px] border-on-background shadow-[4px_4px_0_#1a1a1a] rotate-8 select-none z-0">
                TRAIT UNIQUE !
            </div>
            <div className="absolute bottom-28 right-8 bg-[#0055FF] text-white font-black text-xl uppercase italic px-3 py-2 border-[3px] border-on-background shadow-[3px_3px_0_#1a1a1a] rotate-3 select-none z-0">
                DÉMASQUÉ !
            </div>
            <div className="absolute bottom-40 left-6 bg-[#FFD60A] text-on-background font-black text-lg uppercase italic px-3 py-1.5 border-[3px] border-on-background shadow-[3px_3px_0_#1a1a1a] -rotate-6 select-none z-0">
                INTRIGUE...
            </div>

            <main className="w-full max-w-[440px] relative z-10 text-center">
                {/* Logo */}
                <div className="mb-8">
                    <div className="inline-flex items-center justify-center w-28 h-28 rounded-none bg-[#FFD60A] border-[4px] border-on-background mb-5 shadow-[6px_6px_0_#1a1a1a] rotate-3">
                        <span className="text-6xl -rotate-3">🕵️‍♂️🎨</span>
                    </div>
                    <h1 className="text-5xl font-black text-on-background tracking-tighter uppercase italic -rotate-1 mb-2"
                        style={{ textShadow: '4px 4px 0 #FF3B30, 6px 6px 0 #1a1a1a' }}>
                        Fake Artist
                    </h1>
                    <p className="text-sm font-black text-on-background/70 uppercase tracking-wider">
                        Un seul dessin · Un imposteur · Saurez-vous le trouver ?
                    </p>
                </div>

                {/* Carte principale */}
                <div className="bg-white border-[4px] border-on-background p-6 shadow-[6px_6px_0_#1a1a1a] flex flex-col gap-4">
                    <button
                        onClick={() => navigate('/fakeartist/host')}
                        className="w-full bg-[#FF3B30] text-white py-4 border-[3px] border-on-background font-black text-sm uppercase tracking-wide shadow-[4px_4px_0_#1a1a1a] hover:shadow-[6px_6px_0_#1a1a1a] hover:translate-x-[-2px] hover:translate-y-[-2px] transition-all flex items-center justify-center gap-2 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">tv</span>
                        Créer une partie (Hôte)
                    </button>
                    <button
                        onClick={() => navigate('/fakeartist/play')}
                        className="w-full bg-[#0055FF] text-white py-4 border-[3px] border-on-background font-black text-sm uppercase tracking-wide shadow-[4px_4px_0_#1a1a1a] hover:shadow-[6px_6px_0_#1a1a1a] hover:translate-x-[-2px] hover:translate-y-[-2px] transition-all flex items-center justify-center gap-2 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">person</span>
                        Rejoindre une partie
                    </button>
                </div>

                <div className="mt-8">
                    <button
                        onClick={() => navigate('/')}
                        className="text-xs font-black text-on-background/60 uppercase tracking-widest hover:text-on-background transition-colors flex items-center justify-center gap-1 mx-auto"
                    >
                        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                        Retour au menu principal
                    </button>
                </div>
            </main>
        </div>
    );
}

export default FakeArtistSelectPage;
