import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { socket } from '../socket';
import { 
    Brain, 
    Globe, 
    PenTool, 
    Palette, 
    Beer, 
    Lock, 
    Sparkles, 
    ArrowRight 
} from 'lucide-react';

const GAMES = [
    {
        id: 'quiz',
        route: '/quiz',
        name: 'NEURAL_QUIZ',
        description: 'Test de QI interactif avec statistiques de réponses et classement en temps réel.',
        tags: ['Quiz', 'Multijoueur', 'Score QI'],
        color: '#10b981',
        colorRgb: '16, 185, 129',
        icon: <Brain className="w-8 h-8" />,
        gridClass: 'md:col-span-2 lg:col-span-2'
    },
    {
        id: 'geo',
        route: '/geo',
        name: 'GEO_TRACKR',
        description: 'Explorez le monde en Street View et devinez votre position sur la carte interactive.',
        tags: ['Géographie', 'Street View', 'Multijoueur'],
        color: '#06b6d4',
        colorRgb: '6, 182, 212',
        icon: <Globe className="w-8 h-8" />,
        gridClass: 'md:col-span-1 lg:col-span-1'
    },
    {
        id: 'draw',
        route: '/draw',
        name: 'DRAW_UP',
        description: 'Dessine et fais deviner ! Clone de Pictionary ultra fluide en temps réel.',
        tags: ['Dessin', 'Temps Réel', 'Multijoueur'],
        color: '#f43f5e',
        colorRgb: '244, 63, 94',
        icon: <PenTool className="w-8 h-8" />,
        gridClass: 'md:col-span-1 lg:col-span-1'
    },
    {
        id: 'color',
        route: '/color',
        name: 'COULEUR_MOI',
        description: 'Clone de Toon Tone : devinez la couleur exacte de personnages célèbres.',
        tags: ['Couleurs', 'Mémoire', 'Multijoueur'],
        color: '#f59e0b',
        colorRgb: '245, 158, 11',
        icon: <Palette className="w-8 h-8" />,
        gridClass: 'md:col-span-1 lg:col-span-1'
    },
    {
        id: 'apero',
        href: 'https://ltnhoot.ltn.re/',
        name: 'APÉRO_QUIZ',
        description: 'Quiz de bar interactif — Les équipes répondent directement sur leur téléphone.',
        tags: ['Quiz', 'Par Équipe', 'Bar'],
        color: '#8b5cf6',
        colorRgb: '139, 92, 246',
        icon: <Beer className="w-8 h-8" />,
        gridClass: 'md:col-span-2 lg:col-span-1'
    }
];

function GameCard({ game, index }) {
    const Wrapper = game.href
        ? ({ children, ...props }) => <a href={game.href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
        : ({ children, ...props }) => <Link to={game.route} {...props}>{children}</Link>;

    const cardVariants = {
        hidden: { y: 30, opacity: 0 },
        visible: {
            y: 0,
            opacity: 1,
            transition: {
                type: 'spring',
                stiffness: 100,
                damping: 15,
                delay: index * 0.1
            }
        }
    };

    return (
        <Wrapper className={`group relative block focus:outline-none h-full ${game.gridClass}`}>
            <motion.div
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                whileHover={{ y: -6, transition: { duration: 0.2 } }}
                className="relative flex flex-col h-full rounded-2xl border bg-[#0d0e12]/60 backdrop-blur-md p-6 cursor-pointer transition-all duration-300 group-focus-visible:ring-2"
                style={{
                    borderColor: `${game.color}20`,
                    boxShadow: `0 4px 30px rgba(0, 0, 0, 0.4), 0 0 20px ${game.color}05`,
                    '--tw-ring-color': game.color,
                }}
            >
                {/* Glow on hover */}
                <div
                    className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                    style={{
                        background: `radial-gradient(circle at 50% 0%, ${game.color}15, transparent 65%)`
                    }}
                />

                {/* Scanline overlay */}
                <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-[0.02] overflow-hidden" aria-hidden="true"
                    style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.15) 2px, rgba(255,255,255,0.15) 4px)' }} />

                {/* Card header icon & details */}
                <div className="flex items-start justify-between mb-5">
                    <div
                        className="w-14 h-14 flex items-center justify-center rounded-xl transition-all duration-300 group-hover:scale-110 shadow-lg"
                        style={{
                            color: game.color,
                            background: `${game.color}10`,
                            borderColor: `${game.color}25`,
                            borderWidth: '1px',
                            boxShadow: `0 0 15px ${game.color}10`
                        }}
                    >
                        {game.icon}
                    </div>

                    <div className="flex flex-wrap gap-1.5 justify-end max-w-[60%]">
                        {game.tags.map(tag => (
                            <span
                                key={tag}
                                className="text-[10px] px-2 py-0.5 rounded-md font-semibold tracking-wider uppercase border"
                                style={{
                                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                                    color: `${game.color}e0`,
                                    background: `${game.color}07`,
                                    borderColor: `${game.color}20`,
                                }}
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Title */}
                <h3
                    className="font-bold text-lg mb-3 tracking-wider uppercase font-headline transition-all duration-300"
                    style={{
                        color: game.color,
                        textShadow: `0 0 15px ${game.color}30`,
                    }}
                >
                    {game.name}
                </h3>

                {/* Description */}
                <p className="text-[#94a3b8] text-sm leading-relaxed mb-6 flex-1 font-body">
                    {game.description}
                </p>

                {/* Play link & Arrow */}
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest font-headline mt-auto transition-colors duration-200"
                     style={{ color: game.color }}>
                    <span>Lancer le jeu</span>
                    <ArrowRight className="w-4 h-4 translate-x-0 group-hover:translate-x-1 transition-transform duration-200" />
                </div>
            </motion.div>
        </Wrapper>
    );
}

function HomePage() {
    const navigate = useNavigate();
    const [isConnected, setIsConnected] = useState(socket.connected);
    const [roomCode, setRoomCode] = useState('');

    useEffect(() => {
        function onConnect() {
            setIsConnected(true);
        }

        function onDisconnect() {
            setIsConnected(false);
        }

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        
        setIsConnected(socket.connected);

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
        };
    }, []);

    const handleQuickJoin = (e) => {
        e.preventDefault();
        if (roomCode.trim()) {
            navigate(`/join/${roomCode.trim().toUpperCase()}`);
        }
    };

    return (
        <>
            <style>{`
                @keyframes grid-scroll {
                    0% { background-position: 0 0; }
                    100% { background-position: 40px 40px; }
                }
                @keyframes blob {
                    0% { transform: translate(0px, 0px) scale(1); }
                    33% { transform: translate(30px, -50px) scale(1.05); }
                    66% { transform: translate(-20px, 20px) scale(0.95); }
                    100% { transform: translate(0px, 0px) scale(1); }
                }
                .bg-grid {
                    background-image:
                        linear-gradient(rgba(99, 102, 241, 0.03) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(99, 102, 241, 0.03) 1px, transparent 1px);
                    background-size: 40px 40px;
                    animation: grid-scroll 12s linear infinite;
                }
                .animate-blob {
                    animation: blob 10s infinite alternate ease-in-out;
                }
                .animation-delay-2000 {
                    animation-delay: 2s;
                }
                .animation-delay-4000 {
                    animation-delay: 4s;
                }
                .scrollbar-thin::-webkit-scrollbar {
                    width: 6px;
                }
                .scrollbar-thin::-webkit-scrollbar-track {
                    background: transparent;
                }
                .scrollbar-thin::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 9999px;
                }
                .scrollbar-thin::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
            `}</style>

            <div className="relative w-full h-screen overflow-y-auto scrollbar-thin flex flex-col items-center bg-[#05050a] text-slate-100 font-body select-none">
                
                {/* Background grid */}
                <div className="bg-grid absolute inset-0 pointer-events-none z-0" aria-hidden="true" />

                {/* Animated blur spots */}
                <div className="absolute top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-violet-600/10 blur-[130px] pointer-events-none animate-blob z-0" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-cyan-600/10 blur-[140px] pointer-events-none animate-blob animation-delay-2000 z-0" />
                <div className="absolute top-[35%] left-[25%] w-[40%] h-[40%] rounded-full bg-emerald-600/5 blur-[120px] pointer-events-none animate-blob animation-delay-4000 z-0" />

                {/* Main page content container */}
                <div className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col min-h-screen">
                    
                    {/* Floating Header */}
                    <header className="flex items-center justify-between w-full mb-12 sm:mb-16">
                        <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
                                <Sparkles className="w-4 h-4 text-white animate-pulse" />
                            </div>
                            <span className="font-headline font-black text-lg tracking-wider text-white">GAME_HUB</span>
                        </div>

                        <div className="flex items-center gap-3">
                            {/* Server Status Pill */}
                            <div className="flex items-center gap-2 bg-[#0d0e12]/60 border border-slate-800/80 rounded-full px-3.5 py-1.5 backdrop-blur-md">
                                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'} animate-pulse`} />
                                <span className="text-[10px] font-headline tracking-widest text-[#94a3b8] uppercase font-semibold">
                                    {isConnected ? 'Serveur en ligne' : 'Serveur hors ligne'}
                                </span>
                            </div>

                            {/* Admin Link */}
                            <Link 
                                to="/admin" 
                                className="p-2.5 rounded-xl bg-[#0d0e12]/60 border border-slate-800/80 text-[#94a3b8] hover:text-white hover:border-slate-700 transition-all flex items-center justify-center backdrop-blur-md"
                                title="Administration"
                            >
                                <Lock className="w-4 h-4" />
                            </Link>
                        </div>
                    </header>

                    {/* Hero Section */}
                    <section className="flex flex-col items-center text-center max-w-3xl mx-auto mb-16">
                        <span className="font-headline font-semibold text-xs tracking-[0.25em] text-[#8b5cf6] uppercase mb-4 px-3 py-1 rounded-full bg-violet-500/5 border border-violet-500/10">
                            Plateforme de Jeux v2.0
                        </span>

                        <h1 className="font-headline font-black text-4xl sm:text-6xl tracking-tight mb-6 bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent drop-shadow-sm leading-none">
                            GAME_HUB
                        </h1>

                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed mb-8 max-w-2xl font-body">
                            Sélectionnez une expérience pour commencer à jouer. Créez un salon en tant qu'hôte pour afficher la partie sur grand écran, ou rejoignez instantanément une partie existante.
                        </p>

                        {/* Quick Join Card */}
                        <motion.form 
                            onSubmit={handleQuickJoin}
                            initial={{ y: 15, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="bg-[#0d0e12]/60 border border-slate-800/80 rounded-2xl p-5 w-full max-w-md shadow-2xl backdrop-blur-md flex flex-col items-start"
                        >
                            <label className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-2 flex items-center gap-1.5 font-headline">
                                <Sparkles className="w-3.5 h-3.5 text-[#06b6d4]" />
                                Rejoindre une partie
                            </label>

                            <div className="flex gap-2.5 w-full">
                                <input
                                    type="text"
                                    className="flex-1 bg-black/40 border border-slate-800 rounded-xl px-4 py-2.5 text-center text-lg font-bold tracking-[0.2em] text-[#06b6d4] focus:outline-none focus:border-[#06b6d4] focus:ring-1 focus:ring-[#06b6d4]/20 transition-all font-headline uppercase"
                                    placeholder="CODE"
                                    maxLength={6}
                                    value={roomCode}
                                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                />
                                <button
                                    type="submit"
                                    disabled={!roomCode.trim()}
                                    className="bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 disabled:from-slate-800 disabled:to-slate-800 text-white rounded-xl px-5 font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-1.5 transition-all shadow-lg hover:shadow-violet-600/20 disabled:shadow-none cursor-pointer disabled:cursor-not-allowed font-headline"
                                >
                                    <span>Rejoindre</span>
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </motion.form>
                    </section>

                    {/* Bento Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full mb-16">
                        {GAMES.map((game, i) => (
                            <GameCard key={game.id} game={game} index={i} />
                        ))}
                    </div>

                    {/* Footer */}
                    <footer className="mt-auto py-8 w-full border-t border-slate-800/40 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <span className="text-[11px] font-headline text-slate-500 tracking-wider">
                            // DÉVELOPPÉ AVEC PASSION POUR DES EXPÉRIENCES UNIQUES
                        </span>
                        <span className="text-[11px] font-headline text-slate-500 tracking-wider">
                            © {new Date().getFullYear()} GAME_HUB - TOUS DROITS RÉSERVÉS
                        </span>
                    </footer>
                </div>
            </div>
        </>
    );
}

export default HomePage;
