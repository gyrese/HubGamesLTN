import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { socket } from '../socket';
import { 
    Brain, 
    Globe, 
    PenTool, 
    Palette, 
    Beer, 
    Lock, 
    Sparkles, 
    ArrowRight,
    Fingerprint,
    Swords,
    Gamepad2,
    Users,
    Zap,
    Search,
    Tv,
    Smartphone,
    Activity,
    Wifi,
    WifiOff,
    Wrench,
    Flame,
    Radio,
    Play,
    SlidersHorizontal,
    Volume2,
    VolumeX
} from 'lucide-react';

const CATEGORIES = [
    { id: 'all', label: 'Tous les Jeux', icon: Flame },
    { id: 'quiz', label: 'Quiz & Savoir', icon: Brain },
    { id: 'creative', label: 'Dessin & Bluff', icon: PenTool },
    { id: 'party', label: 'Bar & Soirée', icon: Swords },
    { id: 'arcade', label: 'Arcade & .IO', icon: Gamepad2 }
];

const GAMES = [
    {
        id: 'quiz',
        route: '/quiz',
        category: 'quiz',
        name: 'NEURAL_QUIZ',
        tagline: 'Test de QI & Quiz Live',
        description: 'Affrontez le bar ou vos amis dans un quiz de culture générale et logique avec calcul de QI instantané.',
        tags: ['Quiz', 'Multijoueur', 'Score QI'],
        color: '#10b981',
        colorRgb: '16, 185, 129',
        icon: Brain,
        players: '2-100 Joueurs',
        badge: 'POPULAIRE',
        statusText: '12 Salons Ouverts',
        cardGif: '/assets/games/quiz_neural.webp',
        buttonGif: '/assets/games/quiz_neural.webp',
        hostRoute: '/quiz',
        playRoute: '/quiz'
    },
    {
        id: 'io',
        route: '/io',
        category: 'arcade',
        name: 'IO_ARENA',
        tagline: 'Combat d\'Arène .IO Multi',
        description: 'Le smartphone devient une manette réactive 60 FPS sans lag. Tout l\'affichage se passe sur le grand écran central.',
        tags: ['Temps Réel', 'Manette Mobile', 'Drop-in'],
        color: '#06b6d4',
        colorRgb: '6, 182, 212',
        icon: Gamepad2,
        players: '2-50 Joueurs',
        badge: 'TEMPS RÉEL',
        statusText: '60 FPS Ultra-Fluide',
        cardGif: '/assets/games/io_arena.webp',
        buttonGif: '/assets/games/io_arena.webp',
        hostRoute: '/io/host',
        playRoute: '/io/play'
    },
    {
        id: 'geo',
        route: '/geo',
        category: 'quiz',
        name: 'GEO_TRACKR',
        tagline: 'Exploration Street View',
        description: 'Explorez le globe en immersion 360° et pointez précisément votre position sur la carte mondiale.',
        tags: ['Street View', 'Monde', 'Géographie'],
        color: '#38bdf8',
        colorRgb: '56, 189, 248',
        icon: Globe,
        players: '1-30 Joueurs',
        badge: 'HD MAPS',
        statusText: 'Street View 360°',
        cardGif: '/assets/games/geo_trackr.webp',
        buttonGif: '/assets/games/geo_trackr.webp',
        hostRoute: '/geo/host',
        playRoute: '/geo/play'
    },
    {
        id: 'draw',
        route: '/draw',
        category: 'creative',
        name: 'DRAW_UP',
        tagline: 'Pictionary Live Ultra-Rapide',
        description: 'Dessinez sur votre écran tactile et faites deviner l\'audience en direct avec synchronisation instantanée.',
        tags: ['Dessin', 'Esquisse', 'Multi-stylet'],
        color: '#f43f5e',
        colorRgb: '244, 63, 94',
        icon: PenTool,
        players: '2-16 Joueurs',
        badge: 'LIVE STROKE',
        statusText: 'Latence 15ms',
        cardGif: '/assets/games/draw_up.webp',
        buttonGif: '/assets/games/draw_up.webp',
        hostRoute: '/draw/host',
        playRoute: '/draw/play'
    },
    {
        id: 'fakeartist',
        route: '/fakeartist',
        category: 'creative',
        name: 'FAKE_ARTIST',
        tagline: 'Bluff & Déduction Sociale',
        description: 'Un seul dessin commun, un trait par tour. Retrouvez l\'imposteur infiltré avant qu\'il ne perce le secret !',
        tags: ['Bluff', 'Imposteur', 'Ambiance'],
        color: '#f97316',
        colorRgb: '249, 115, 22',
        icon: Fingerprint,
        players: '4-10 Joueurs',
        badge: 'BLUFF',
        statusText: '1 Traître Caché',
        cardGif: '/assets/games/fake_artist.webp',
        buttonGif: '/assets/games/fake_artist.webp',
        hostRoute: '/fakeartist/host',
        playRoute: '/fakeartist/play'
    },
    {
        id: 'color',
        route: '/color',
        category: 'creative',
        name: 'COULEUR_MOI',
        tagline: 'Nuancier & Pop Culture',
        description: 'Toon Tone : devinez la teinte exacte des personnages célèbres avant la fin du chronomètre.',
        tags: ['Couleurs', 'Mémoire', 'Rapidité'],
        color: '#eab308',
        colorRgb: '234, 179, 8',
        icon: Palette,
        players: '1-20 Joueurs',
        badge: 'NUANCIER',
        statusText: '500+ Niveaux',
        cardGif: '/assets/games/color_moi.webp',
        buttonGif: '/assets/games/color_moi.webp',
        hostRoute: '/color/host',
        playRoute: '/color/play'
    },
    {
        id: 'party',
        route: '/party',
        category: 'party',
        name: 'SUPER_LTN_PARTY',
        tagline: 'Conquête de Bar par Équipes',
        description: 'Les tables du bar s\'affrontent manche après manche et étendent leur territoire sur la carte des Toiles Noires.',
        tags: ['Par Table', 'Plateau TV', 'Guerre de Bar'],
        color: '#a855f7',
        colorRgb: '168, 85, 247',
        icon: Swords,
        players: '2-12 Équipes',
        badge: 'PAR ÉQUIPE',
        statusText: 'Mode Guerre de Bar',
        cardGif: '/assets/games/party_ltn.webp',
        buttonGif: '/assets/games/party_ltn.webp',
        hostRoute: '/party/host',
        playRoute: '/party/play'
    },
    {
        id: 'apero',
        href: 'https://ltnhoot.ltn.re/',
        category: 'party',
        name: 'APÉRO_QUIZ',
        tagline: 'Quiz Officiel avec Buzzer Smartphone',
        description: 'Le grand quiz du bar en direct — Les équipes s\'enregistrent et buzzent instantanément sur leurs smartphones.',
        tags: ['Buzzer Live', 'Écran Bar', 'En Direct'],
        color: '#ec4899',
        colorRgb: '236, 72, 153',
        icon: Beer,
        players: 'Illimité',
        badge: 'LIVE BAR',
        statusText: 'Web App Directe',
        cardGif: '/assets/games/apero_quiz.webp',
        buttonGif: '/assets/games/apero_quiz.webp',
        hostRoute: 'https://ltnhoot.ltn.re/',
        playRoute: 'https://ltnhoot.ltn.re/'
    }
];

// Carte avec Motion Design 3D Tilt & Fond GIF interactif
function MotionGameCard({ game, index, maintenance }) {
    const cardRef = useRef(null);
    const [isHovered, setIsHovered] = useState(false);

    // 3D Tilt Physics via Framer Motion
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    const springConfig = { damping: 20, stiffness: 200 };
    const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [7, -7]), springConfig);
    const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-7, 7]), springConfig);
    const lightX = useTransform(mouseX, [-0.5, 0.5], [20, 80]);
    const lightY = useTransform(mouseY, [-0.5, 0.5], [20, 80]);

    const handleMouseMove = (e) => {
        if (!cardRef.current || maintenance) return;
        const rect = cardRef.current.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const xFromCenter = (e.clientX - rect.left) / width - 0.5;
        const yFromCenter = (e.clientY - rect.top) / height - 0.5;
        mouseX.set(xFromCenter);
        mouseY.set(yFromCenter);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        mouseX.set(0);
        mouseY.set(0);
    };

    const Icon = game.icon;

    return (
        <motion.div
            ref={cardRef}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={handleMouseLeave}
            style={{
                perspective: 1000,
                rotateX: isHovered ? rotateX : 0,
                rotateY: isHovered ? rotateY : 0,
                transformStyle: 'preserve-3d'
            }}
            className={`relative flex flex-col justify-between rounded-[26px] bg-[#0c0f18] border transition-all duration-300 ${
                maintenance ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:z-20 cursor-pointer'
            }`}
        >
            {/* Border Sheen & Dynamic Glowing Outline */}
            <div 
                className="absolute inset-0 rounded-[26px] pointer-events-none transition-opacity duration-500"
                style={{
                    border: `1.5px solid ${isHovered ? game.color : 'rgba(255,255,255,0.08)'}`,
                    boxShadow: isHovered 
                        ? `0 25px 50px -12px rgba(0, 0, 0, 0.9), 0 0 35px -5px ${game.color}35`
                        : '0 10px 25px -5px rgba(0,0,0,0.5)'
                }}
            />

            {/* Maintenance Badge */}
            {maintenance && (
                <div className="absolute top-4 right-4 z-30 flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/30 border border-amber-500 text-amber-200 text-[11px] font-mono font-bold tracking-widest uppercase backdrop-blur-md shadow-lg">
                    <Wrench className="w-3.5 h-3.5" />
                    <span>Maintenance</span>
                </div>
            )}

            {/* ======================================================== */}
            {/* 1. SECTION BANNIÈRE MÉDIA / GIF ANIMÉ                    */}
            {/* ======================================================== */}
            <div className="relative w-full h-44 sm:h-48 overflow-hidden rounded-t-[25px] bg-[#07080d]">
                {/* Image ou GIF de fond */}
                {game.cardGif ? (
                    <motion.div 
                        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 ease-out filter brightness-[0.9] contrast-[1.15]"
                        style={{ 
                            backgroundImage: `url(${game.cardGif})`,
                            scale: isHovered ? 1.08 : 1
                        }}
                    />
                ) : (
                    <div 
                        className="absolute inset-0 bg-gradient-to-br"
                        style={{ background: `linear-gradient(135deg, ${game.color}30 0%, #0c0f18 100%)` }}
                    />
                )}

                {/* Dégradé vigneté pour fondre la bannière avec le corps de la carte */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0c0f18] via-[#0c0f18]/40 to-black/30" />

                {/* Scanlines tech */}
                <div 
                    className="absolute inset-0 opacity-[0.06] pointer-events-none"
                    style={{
                        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.4) 2px, rgba(255,255,255,0.4) 4px)'
                    }}
                />

                {/* Top Icon Box sur la bannière */}
                <div className="absolute top-3.5 left-3.5 z-10">
                    <div 
                        className="w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl shadow-lg transition-transform duration-300 group-hover:scale-110"
                        style={{
                            backgroundColor: `${game.color}25`,
                            border: `1.5px solid ${game.color}60`,
                            color: game.color,
                            boxShadow: `0 0 20px ${game.color}30`
                        }}
                    >
                        <Icon className="w-5 h-5" />
                    </div>
                </div>

                {/* Floating Players Tag */}
                <div className="absolute bottom-3 left-4 z-10 flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-white bg-black/70 px-2.5 py-1 rounded-xl backdrop-blur-md border border-white/10 shadow-lg">
                        <Users className="w-3.5 h-3.5" style={{ color: game.color }} />
                        <span>{game.players}</span>
                    </span>
                </div>
            </div>

            {/* ======================================================== */}
            {/* 2. CORPS D'INFORMATIONS DU JEU                          */}
            {/* ======================================================== */}
            <div className="p-4 sm:p-5 flex-1 flex flex-col justify-start gap-1.5">
                <div>
                    <h3 className="text-lg sm:text-xl font-black font-headline tracking-wide uppercase text-white flex items-center gap-2">
                        <span>{game.name}</span>
                    </h3>
                    <p className="text-xs font-semibold mt-0.5" style={{ color: game.color }}>
                        {game.tagline}
                    </p>
                </div>
                <p className="text-slate-400 text-xs sm:text-sm leading-relaxed line-clamp-2">
                    {game.description}
                </p>
            </div>

            {/* ======================================================== */}
            {/* 3. BOUTONS D'ACTION AVEC FOND GIF ET EFFETS MULTIPLES    */}
            {/* ======================================================== */}
            <div className="p-5 sm:p-6 pt-0">
                {game.href ? (
                    <a
                        href={maintenance ? undefined : game.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`relative w-full overflow-hidden group/btn flex items-center justify-center gap-2 py-3.5 px-5 rounded-2xl font-headline font-black text-xs uppercase tracking-widest text-white transition-all duration-300 active:scale-[0.98] ${
                            maintenance ? 'pointer-events-none' : 'hover:brightness-110 shadow-lg'
                        }`}
                        style={{
                            background: `linear-gradient(135deg, ${game.color}50 0%, ${game.color}20 100%)`,
                            border: `1.5px solid ${game.color}80`,
                            boxShadow: `0 8px 25px ${game.color}30`
                        }}
                    >
                        {/* Arrière-plan GIF du bouton */}
                        {game.buttonGif && (
                            <div 
                                className="absolute inset-0 bg-cover bg-center opacity-35 group-hover/btn:opacity-60 transition-opacity duration-300"
                                style={{ backgroundImage: `url(${game.buttonGif})` }}
                            />
                        )}
                        <span className="relative z-10 flex items-center gap-2 drop-shadow">
                            <span>Lancer l'App</span>
                            <ArrowRight className="w-4 h-4 transition-transform group-hover/btn:translate-x-1" />
                        </span>
                    </a>
                ) : (
                    <div className="grid grid-cols-2 gap-2.5">
                        {/* Bouton Grand Écran TV (Host) */}
                        <Link
                            to={maintenance ? '#' : game.hostRoute}
                            className={`relative overflow-hidden group/btn flex items-center justify-center gap-2 py-3 px-3 rounded-2xl font-headline font-bold text-[11px] uppercase tracking-wider text-slate-200 transition-all duration-200 active:scale-[0.97] ${
                                maintenance ? 'pointer-events-none' : 'hover:bg-white/10 hover:text-white hover:border-white/30'
                            }`}
                            style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                backdropFilter: 'blur(10px)'
                            }}
                        >
                            <Tv className="w-3.5 h-3.5 text-slate-400 group-hover/btn:text-white transition-colors" />
                            <span className="relative z-10">Grand Écran</span>
                        </Link>

                        {/* Bouton Jouer / Rejoindre avec Fond GIF */}
                        <Link
                            to={maintenance ? '#' : game.playRoute}
                            className={`relative overflow-hidden group/btn flex items-center justify-center gap-2 py-3 px-3 rounded-2xl font-headline font-black text-[11px] uppercase tracking-wider text-white transition-all duration-200 active:scale-[0.97] ${
                                maintenance ? 'pointer-events-none' : 'hover:brightness-115'
                            }`}
                            style={{
                                background: `linear-gradient(135deg, ${game.color}60 0%, ${game.color}30 100%)`,
                                border: `1.5px solid ${game.color}80`,
                                boxShadow: `0 4px 20px ${game.color}35`
                            }}
                        >
                            {/* Fond GIF du bouton */}
                            {game.buttonGif && (
                                <div 
                                    className="absolute inset-0 bg-cover bg-center opacity-40 group-hover/btn:opacity-70 transition-opacity duration-300"
                                    style={{ backgroundImage: `url(${game.buttonGif})` }}
                                />
                            )}
                            <Smartphone className="w-3.5 h-3.5 relative z-10" style={{ color: game.color }} />
                            <span className="relative z-10 flex items-center gap-1">
                                <span>Jouer</span>
                                <Play className="w-3 h-3 fill-current ml-0.5 group-hover/btn:translate-x-0.5 transition-transform" />
                            </span>
                        </Link>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

export default function HomePage() {
    const navigate = useNavigate();
    const [isConnected, setIsConnected] = useState(socket.connected);
    const [gameStatus, setGameStatus] = useState({});
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [quickCode, setQuickCode] = useState('');
    const [ping] = useState(Math.floor(Math.random() * 8) + 14);

    useEffect(() => {
        const base = import.meta.env.VITE_SERVER_URL
            ? `${import.meta.env.VITE_SERVER_URL}/api`
            : (!import.meta.env.DEV
                ? '/api'
                : `${window.location.protocol}//${window.location.hostname}:${window.location.protocol === 'https:' ? 3443 : 3005}/api`);

        fetch(`${base}/games/status`)
            .then((r) => (r.ok ? r.json() : {}))
            .then(setGameStatus)
            .catch(() => { /* tolérance hors-ligne */ });
    }, []);

    useEffect(() => {
        function onConnect() { setIsConnected(true); }
        function onDisconnect() { setIsConnected(false); }

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
        if (quickCode.trim()) {
            navigate(`/join/${quickCode.trim().toUpperCase()}`);
        }
    };

    const categoryCounts = useMemo(() => {
        const counts = { all: GAMES.length };
        GAMES.forEach(g => {
            counts[g.category] = (counts[g.category] || 0) + 1;
        });
        return counts;
    }, []);

    const filteredGames = useMemo(() => {
        return GAMES.filter(game => {
            if (gameStatus[game.id] === 'hidden') return false;
            const matchesCategory = selectedCategory === 'all' || game.category === selectedCategory;
            const matchesSearch = searchQuery === '' || 
                game.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                game.tagline.toLowerCase().includes(searchQuery.toLowerCase()) ||
                game.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                game.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
            return matchesCategory && matchesSearch;
        });
    }, [selectedCategory, searchQuery, gameStatus]);

    return (
        <div className="min-h-screen w-full bg-[#07080d] text-slate-100 flex flex-col font-body selection:bg-cyan-500 selection:text-black">
            
            {/* Ambient Background Light Blobs */}
            <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
                <div 
                    className="absolute inset-0 opacity-[0.035]"
                    style={{
                        backgroundImage: `
                            linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
                            linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
                        `,
                        backgroundSize: '40px 40px'
                    }}
                />
                <div className="absolute -top-32 left-1/4 w-[650px] h-[650px] rounded-full bg-cyan-500/10 blur-[160px]" />
                <div className="absolute top-1/2 -right-40 w-[600px] h-[600px] rounded-full bg-purple-600/10 blur-[170px]" />
                <div className="absolute -bottom-40 left-1/3 w-[700px] h-[700px] rounded-full bg-emerald-600/10 blur-[180px]" />
            </div>

            {/* Header Sticky Navigation */}
            <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#07080d]/90 backdrop-blur-2xl px-4 sm:px-8 py-3 shadow-2xl">
                <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
                    
                    {/* Brand / Logo */}
                    <Link to="/" className="flex items-center gap-3 group">
                        <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-400 via-teal-400 to-indigo-500 p-[1.5px] shadow-lg shadow-cyan-500/20 group-hover:shadow-cyan-500/40 transition-all">
                            <div className="w-full h-full bg-[#090b14] rounded-[14px] flex items-center justify-center">
                                <Sparkles className="w-5 h-5 text-cyan-400 group-hover:rotate-12 transition-transform duration-300" />
                            </div>
                        </div>
                        <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                                <span className="font-headline font-black text-lg tracking-wider text-white leading-none">
                                    LTN<span className="text-cyan-400">_</span>HUB
                                </span>
                                <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-[9px] font-mono font-bold text-cyan-400 uppercase tracking-widest">
                                    ARCADE v2.5
                                </span>
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 tracking-widest uppercase">
                                TOILES NOIRES
                            </span>
                        </div>
                    </Link>

                    {/* Quick Code Room Launcher (Desktop) */}
                    <form onSubmit={handleQuickJoin} className="hidden md:flex items-center gap-1.5 bg-white/[0.04] border border-white/10 rounded-2xl p-1 pl-3.5 backdrop-blur-md focus-within:border-cyan-400/60 focus-within:ring-2 focus-within:ring-cyan-400/20 transition-all">
                        <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="CODE ROOM..."
                            maxLength={6}
                            value={quickCode}
                            onChange={(e) => setQuickCode(e.target.value.toUpperCase())}
                            className="w-28 bg-transparent text-xs font-mono font-bold tracking-widest text-white uppercase placeholder:text-slate-500 focus:outline-none"
                        />
                        <button 
                            type="submit" 
                            className="px-3 py-1.5 rounded-xl bg-cyan-400 text-black text-[11px] font-headline font-black uppercase hover:bg-cyan-300 transition-all active:scale-95 shadow-md shadow-cyan-400/20"
                        >
                            Rejoindre
                        </button>
                    </form>

                    {/* Right Tools & Server State */}
                    <div className="flex items-center gap-2.5 sm:gap-3">
                        {/* Mobile Quick Join */}
                        <Link
                            to="/join"
                            className="md:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-400 text-black text-xs font-bold font-headline uppercase active:scale-95 shadow-md shadow-cyan-400/20"
                        >
                            <Smartphone className="w-3.5 h-3.5" />
                            <span>Rejoindre</span>
                        </Link>

                        {/* Server Status Pill */}
                        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 backdrop-blur-md">
                            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'} animate-pulse`} />
                            <span className="text-[11px] font-mono font-bold text-slate-300 hidden sm:inline">
                                {isConnected ? `EN LIGNE (${ping}ms)` : 'HORS-LIGNE'}
                            </span>
                        </div>

                        {/* Admin Link */}
                        <Link 
                            to="/admin" 
                            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all backdrop-blur-md"
                            title="Console Admin"
                        >
                            <Lock className="w-4 h-4" />
                        </Link>
                    </div>
                </div>
            </header>

            {/* Main Page Body */}
            <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8 flex flex-col">
                
                {/* Hero Headline Section */}
                <section className="mb-6 flex flex-col md:flex-row items-start md:items-end justify-between gap-4 border-b border-white/5 pb-6">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-mono font-semibold uppercase tracking-wider mb-2">
                            <Radio className="w-3 h-3 animate-pulse" />
                            <span>Plateforme d'expériences interactives</span>
                        </div>
                        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black font-headline tracking-tight text-white uppercase leading-none">
                            HUB <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-indigo-400">DES JEUX</span>
                        </h1>
                        <p className="text-slate-400 text-xs sm:text-sm mt-1.5 max-w-xl">
                            Lancez une partie sur grand écran pour le bar ou rejoignez instantanément depuis votre smartphone sans rien installer.
                        </p>
                    </div>

                    {/* Compact Live Highlights */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs font-mono text-slate-300 backdrop-blur-md">
                            <span className="w-2 h-2 rounded-full bg-cyan-400" />
                            <span className="font-bold text-white">{GAMES.length} Jeux</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs font-mono text-slate-300 backdrop-blur-md">
                            <Zap className="w-3.5 h-3.5 text-yellow-400" />
                            <span>100% Temps Réel</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs font-mono text-slate-300 backdrop-blur-md">
                            <Tv className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Écran TV & Mobile</span>
                        </div>
                    </div>
                </section>

                {/* Categories & Search Filter Dock */}
                <section className="mb-7 bg-[#0c0f18]/80 border border-white/10 rounded-2xl p-2.5 backdrop-blur-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-xl">
                    {/* Category Filter Pills (No Scrollbar, clean flex-wrap) */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        {CATEGORIES.map(cat => {
                            const CatIcon = cat.icon;
                            const isActive = selectedCategory === cat.id;
                            const count = categoryCounts[cat.id] || 0;
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => setSelectedCategory(cat.id)}
                                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-headline font-bold uppercase tracking-wider transition-all duration-200 ${
                                        isActive
                                            ? 'bg-cyan-400 text-black shadow-md shadow-cyan-400/25 scale-[1.02]'
                                            : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/5'
                                    }`}
                                >
                                    <CatIcon className="w-3.5 h-3.5" />
                                    <span>{cat.label}</span>
                                    <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono ${isActive ? 'bg-black/20 text-black font-black' : 'bg-white/10 text-slate-400'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Search Input */}
                    <div className="relative min-w-[240px]">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            placeholder="Rechercher un jeu..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-8 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40 backdrop-blur-md font-body"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </section>

                {/* 3-Column Grid of Games (Fully Accessible and Scrollable) */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-7 w-full pb-12">
                    {filteredGames.length > 0 ? (
                        filteredGames.map((game, i) => (
                            <MotionGameCard
                                key={game.id}
                                game={game}
                                index={i}
                                maintenance={gameStatus[game.id] === 'maintenance'}
                            />
                        ))
                    ) : (
                        <div className="col-span-full py-20 flex flex-col items-center justify-center text-center rounded-3xl border border-white/5 bg-white/[0.02]">
                            <Search className="w-12 h-12 text-slate-600 mb-3" />
                            <p className="text-slate-300 font-headline font-bold text-base">Aucun jeu ne correspond à votre recherche</p>
                            <button
                                onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }}
                                className="mt-3 text-xs text-cyan-400 underline hover:text-cyan-300 font-mono"
                            >
                                Réinitialiser les filtres
                            </button>
                        </div>
                    )}
                </div>

            </main>

            {/* Footer */}
            <footer className="relative z-10 w-full border-t border-white/10 bg-[#07080d]/80 backdrop-blur-md py-6 px-4 sm:px-8">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-400">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                        <span>LTN GAME_HUB // TOILES NOIRES INTERACTIVE SYSTEM</span>
                    </div>
                    <span>© {new Date().getFullYear()} Tous droits réservés</span>
                </div>
            </footer>
        </div>
    );
}
