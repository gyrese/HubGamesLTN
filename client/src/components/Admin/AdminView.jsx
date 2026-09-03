import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Brain, 
    Globe, 
    Paintbrush, 
    Palette, 
    ArrowLeft, 
    LogOut, 
    Plus, 
    Edit2, 
    Trash2, 
    HelpCircle,
    ListFilter,
    LayoutGrid
} from 'lucide-react';
import QuizEditor from './QuizEditor';
import DrawAdmin from './DrawAdmin';
import GeoAdmin from './GeoAdmin';
import ColorAdmin from './ColorAdmin';
import GamesAdmin from './GamesAdmin';
import Login from './Login';

const isHttps = window.location.protocol === 'https:';
const serverPort = isHttps ? 3443 : 3005;
const API_URL = import.meta.env.VITE_SERVER_URL 
    ? `${import.meta.env.VITE_SERVER_URL}/api`
    : (!import.meta.env.DEV ? '/api' : `${window.location.protocol}//${window.location.hostname}:${serverPort}/api`);

function AdminView() {
    const navigate = useNavigate();
    const [token, setToken] = useState(localStorage.getItem('admin_token') || '');
    const [activeTab, setActiveTab] = useState('quizzes'); // 'quizzes', 'geo', 'draw', 'color'

    // Quiz State
    const [quizzes, setQuizzes] = useState([]);
    const [editingQuiz, setEditingQuiz] = useState(null); // null = list, 'new' = create, object = edit

    useEffect(() => {
        if (token && activeTab === 'quizzes') {
            fetchQuizzes();
        }
    }, [activeTab, token]);

    useEffect(() => {
        const handleLogoutEvent = () => {
            setToken('');
        };
        window.addEventListener('admin-logout', handleLogoutEvent);
        return () => window.removeEventListener('admin-logout', handleLogoutEvent);
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('admin_token');
        setToken('');
    };

    const fetchQuizzes = async () => {
        try {
            const response = await fetch(`${API_URL}/quizzes`);
            const data = await response.json();
            if (response.ok) {
                setQuizzes(data);
            }
        } catch (error) {
            console.error("Erreur chargement quiz:", error);
        }
    };

    const handleDeleteQuiz = async (id) => {
        if (window.confirm("Supprimer ce quiz ?")) {
            try {
                const response = await fetch(`${API_URL}/quizzes/${id}`, { method: 'DELETE' });
                if (response.ok) {
                    fetchQuizzes();
                }
            } catch (error) {
                console.error("Erreur suppression:", error);
            }
        }
    };

    // Si l'utilisateur n'est pas connecté, afficher le formulaire de connexion
    if (!token) {
        return <Login onLoginSuccess={(t) => setToken(t)} />;
    }

    // Render Logic
    const renderContent = () => {
        if (activeTab === 'draw') {
            return <DrawAdmin />;
        }

        if (activeTab === 'geo') {
            return <GeoAdmin />;
        }

        if (activeTab === 'color') {
            return <ColorAdmin />;
        }

        if (activeTab === 'games') {
            return <GamesAdmin token={token} apiUrl={API_URL} />;
        }

        // Quizzes Tab
        if (editingQuiz) {
            return (
                <QuizEditor
                    quiz={editingQuiz === 'new' ? null : editingQuiz}
                    onSave={() => { setEditingQuiz(null); fetchQuizzes(); }}
                    onCancel={() => setEditingQuiz(null)}
                />
            );
        }

        return (
            <div className="space-y-6">
                <div className="flex justify-between items-center pb-4 border-b border-slate-800/60">
                    <div className="flex items-center gap-2">
                        <ListFilter className="w-5 h-5 text-emerald-400" />
                        <h3 className="text-lg font-bold text-slate-200 uppercase tracking-wider font-display m-0">Quizzes Disponibles</h3>
                    </div>
                    <button 
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition-all rounded-xl text-white text-xs font-bold uppercase tracking-widest shadow-lg shadow-emerald-500/20"
                        onClick={() => setEditingQuiz('new')}
                    >
                        <Plus className="w-4 h-4" />
                        Nouveau Quiz
                    </button>
                </div>

                {quizzes.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 font-medium bg-slate-900/10 rounded-2xl border border-dashed border-slate-800">
                        Aucun quiz disponible. Cliquez sur "Nouveau Quiz" pour commencer.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {quizzes.map(quiz => (
                            <div key={quiz.id} className="group relative bg-slate-900/30 backdrop-blur-sm border border-slate-800/80 rounded-2xl p-6 transition-all duration-300 hover:border-emerald-500/40 hover:bg-slate-900/50 shadow-lg hover:shadow-emerald-950/10">
                                <div className="flex justify-between items-start gap-4">
                                    <div className="space-y-2">
                                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                                            <HelpCircle className="w-3.5 h-3.5" />
                                            {quiz.questions.length} questions
                                        </div>
                                        <h4 className="text-lg font-bold text-slate-100 group-hover:text-emerald-400 transition-colors tracking-wide font-display m-0">
                                            {quiz.title}
                                        </h4>
                                        <p className="text-sm text-slate-400 line-clamp-2 leading-relaxed">
                                            {quiz.description || "Aucune description fournie pour ce quiz."}
                                        </p>
                                    </div>
                                    
                                    <div className="flex gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
                                        <button 
                                            className="p-2 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-emerald-400 rounded-xl transition-all"
                                            onClick={() => setEditingQuiz(quiz)}
                                            title="Éditer le quiz"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button 
                                            className="p-2 bg-slate-850 hover:bg-red-950/40 border border-slate-700 hover:border-red-500/30 text-slate-300 hover:text-red-400 rounded-xl transition-all"
                                            onClick={() => handleDeleteQuiz(quiz.id)}
                                            title="Supprimer le quiz"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // Obtenir la couleur et l'icône actives pour la bordure inférieure de l'onglet actif
    const getActiveTabGlow = () => {
        switch(activeTab) {
            case 'quizzes': return 'border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.08)]';
            case 'geo': return 'border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.08)]';
            case 'draw': return 'border-pink-500/30 shadow-[0_0_20px_rgba(236,72,153,0.08)]';
            case 'color': return 'border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.08)]';
            case 'games': return 'border-violet-500/30 shadow-[0_0_20px_rgba(139,92,246,0.08)]';
            default: return 'border-slate-800/80';
        }
    };

    return (
        <div className="h-screen w-full overflow-y-auto text-slate-100 bg-slate-950/20 select-none scrollbar-thin">
            <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-8 pb-32">
                {/* Top Bar / Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/30 backdrop-blur-md border border-slate-800/80 p-4 md:p-5 rounded-2xl">
                    <div className="flex items-center gap-3">
                        <button 
                            className="flex items-center justify-center p-2.5 bg-slate-850 hover:bg-slate-800 border border-slate-700/80 rounded-xl text-slate-400 hover:text-white transition-all active:scale-[0.97]" 
                            onClick={() => navigate('/')}
                            title="Retour à l'accueil"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </button>
                        <div>
                            <h1 className="text-xl md:text-2xl font-black tracking-widest bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent font-display uppercase m-0">
                                Console Admin
                            </h1>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest m-0 font-semibold">
                                Gestion des configurations du Game Hub
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-4">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-850 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                            Admin connecté
                        </span>
                        <button 
                            className="flex items-center gap-2 px-4 py-2.5 bg-red-950/20 hover:bg-red-900/30 border border-red-500/20 hover:border-red-500/40 text-red-400 rounded-xl text-xs font-bold uppercase tracking-wider transition-all active:scale-[0.97]"
                            onClick={handleLogout}
                        >
                            <LogOut className="w-4 h-4" />
                            Déconnexion
                        </button>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
                    <button
                        className={`flex items-center justify-center gap-3 px-5 py-4 rounded-2xl border transition-all duration-300 font-display text-sm tracking-wider uppercase font-extrabold active:scale-[0.98] ${
                            activeTab === 'quizzes'
                                ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                                : 'bg-slate-900/30 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                        onClick={() => { setActiveTab('quizzes'); setEditingQuiz(null); }}
                    >
                        <Brain className="w-5 h-5" />
                        Neural Quiz
                    </button>

                    <button
                        className={`flex items-center justify-center gap-3 px-5 py-4 rounded-2xl border transition-all duration-300 font-display text-sm tracking-wider uppercase font-extrabold active:scale-[0.98] ${
                            activeTab === 'geo'
                                ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                                : 'bg-slate-900/30 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                        onClick={() => { setActiveTab('geo'); setEditingQuiz(null); }}
                    >
                        <Globe className="w-5 h-5" />
                        Geo Trackr
                    </button>

                    <button
                        className={`flex items-center justify-center gap-3 px-5 py-4 rounded-2xl border transition-all duration-300 font-display text-sm tracking-wider uppercase font-extrabold active:scale-[0.98] ${
                            activeTab === 'draw'
                                ? 'bg-pink-500/10 border-pink-500 text-pink-400 shadow-[0_0_15px_rgba(236,72,153,0.15)]'
                                : 'bg-slate-900/30 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                        onClick={() => { setActiveTab('draw'); setEditingQuiz(null); }}
                    >
                        <Paintbrush className="w-5 h-5" />
                        Draw Up
                    </button>

                    <button
                        className={`flex items-center justify-center gap-3 px-5 py-4 rounded-2xl border transition-all duration-300 font-display text-sm tracking-wider uppercase font-extrabold active:scale-[0.98] ${
                            activeTab === 'color'
                                ? 'bg-amber-500/10 border-amber-500 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                                : 'bg-slate-900/30 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                        onClick={() => { setActiveTab('color'); setEditingQuiz(null); }}
                    >
                        <Palette className="w-5 h-5" />
                        Couleur Moi
                    </button>

                    <button
                        className={`flex items-center justify-center gap-3 px-5 py-4 rounded-2xl border transition-all duration-300 font-display text-sm tracking-wider uppercase font-extrabold active:scale-[0.98] ${
                            activeTab === 'games'
                                ? 'bg-violet-500/10 border-violet-500 text-violet-400 shadow-[0_0_15px_rgba(139,92,246,0.15)]'
                                : 'bg-slate-900/30 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                        onClick={() => { setActiveTab('games'); setEditingQuiz(null); }}
                    >
                        <LayoutGrid className="w-5 h-5" />
                        Jeux du hub
                    </button>
                </div>

                {/* Content Area */}
                <div className={`bg-slate-900/20 backdrop-blur-md border rounded-3xl p-6 md:p-8 transition-all duration-500 ${getActiveTabGlow()}`}>
                    <div className="animate-[fadeIn_0.4s_ease-out]">
                        {renderContent()}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AdminView;

