import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Monitor, Play, Smartphone } from 'lucide-react';
import '../../components/Party/PartyStyles.css';

const ROUND_CHOICES = [6, 10, 15];

// Les familles que l'hôte peut activer. Sans matériel préparé, `DIGITAL` seul
// suffit à faire tourner une partie : c'est ce qui garde le jeu lançable un
// mardi soir sans rien avoir anticipé.
const FAMILIES = [
    {
        id: 'DIGITAL',
        name: 'Sur téléphone',
        description: 'Réflexe, rapidité, mémoire. Aucun matériel.',
    },
    {
        id: 'CREATIVE',
        name: 'Création à la table',
        description: 'Le champion dessine, photographie, le bar vote. Papier et stylo requis.',
    },
];

function PartySelectPage() {
    const navigate = useNavigate();
    const [totalRounds, setTotalRounds] = useState(10);
    const [families, setFamilies] = useState(['DIGITAL', 'CREATIVE']);

    useEffect(() => {
        document.body.classList.add('party-theme');
        return () => document.body.classList.remove('party-theme');
    }, []);

    const toggleFamily = (id) => {
        setFamilies((prev) => {
            if (prev.includes(id)) {
                // Il faut toujours au moins une famille active.
                return prev.length === 1 ? prev : prev.filter((f) => f !== id);
            }
            return [...prev, id];
        });
    };

    const materials = families.includes('CREATIVE')
        ? ['1 feuille de papier et un stylo par table']
        : [];

    return (
        <div className="pty-root flex items-center justify-center p-6">
            <main className="w-full max-w-2xl flex flex-col gap-6">
                <div className="text-center">
                    <h1 className="pty-title" style={{ fontSize: 'clamp(2.5rem, 8vw, 4.5rem)' }}>
                        Super LTN Party
                    </h1>
                    <p className="mt-3 text-lg" style={{ color: 'var(--pty-muted)' }}>
                        Les tables du bar s'affrontent et se disputent le territoire.
                    </p>
                </div>

                <section className="pty-panel p-6 flex flex-col gap-5">
                    <div>
                        <p className="pty-eyebrow mb-3">Nombre de manches</p>
                        <div className="flex gap-3">
                            {ROUND_CHOICES.map((count) => (
                                <button
                                    key={count}
                                    type="button"
                                    className={`pty-btn flex-1 ${totalRounds === count ? 'pty-btn-primary' : ''}`}
                                    onClick={() => setTotalRounds(count)}
                                >
                                    {count}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p className="pty-eyebrow mb-3">Types d'épreuves</p>
                        <div className="flex flex-col gap-3">
                            {FAMILIES.map((family) => {
                                const active = families.includes(family.id);
                                return (
                                    <button
                                        key={family.id}
                                        type="button"
                                        className="pty-panel p-4 text-left flex items-start gap-3"
                                        style={{
                                            borderColor: active ? 'var(--pty-accent)' : 'var(--pty-border)',
                                            opacity: active ? 1 : 0.5,
                                            cursor: 'pointer',
                                        }}
                                        onClick={() => toggleFamily(family.id)}
                                    >
                                        {family.id === 'DIGITAL'
                                            ? <Smartphone className="w-5 h-5 mt-0.5 flex-shrink-0" />
                                            : <Monitor className="w-5 h-5 mt-0.5 flex-shrink-0" />}
                                        <span>
                                            <span className="font-black block">{family.name}</span>
                                            <span className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                                                {family.description}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {materials.length > 0 && (
                        <div className="pty-panel p-4">
                            <p className="pty-eyebrow mb-2">À préparer avant de lancer</p>
                            {materials.map((item) => (
                                <p key={item} className="text-sm">· {item}</p>
                            ))}
                        </div>
                    )}

                    <button
                        type="button"
                        className="pty-btn pty-btn-primary w-full"
                        style={{ minHeight: 60 }}
                        onClick={() => navigate('/party/host', { state: { settings: { totalRounds, families } } })}
                    >
                        <Play className="w-5 h-5" />
                        Ouvrir sur le grand écran
                    </button>

                    <button
                        type="button"
                        className="pty-btn pty-btn-ghost w-full"
                        onClick={() => navigate('/party/play')}
                    >
                        <Smartphone className="w-5 h-5" />
                        Rejoindre depuis un téléphone
                    </button>
                </section>

                <button
                    type="button"
                    className="pty-btn pty-btn-ghost mx-auto"
                    onClick={() => navigate('/')}
                >
                    <ArrowLeft className="w-4 h-4" />
                    Retour au menu
                </button>
            </main>
        </div>
    );
}

export default PartySelectPage;
