import { useState, useEffect, useRef } from 'react';
import { 
    Plus, 
    Edit2, 
    Trash2, 
    Loader2, 
    Search,
    Type,
    HelpCircle,
    Bookmark,
    Save,
    X,
    Upload,
    Download
} from 'lucide-react';

const isHttps = window.location.protocol === 'https:';
const serverPort = isHttps ? 3443 : 3005;
const API_URL = import.meta.env.VITE_SERVER_URL 
    ? `${import.meta.env.VITE_SERVER_URL}/api/admin/draw`
    : (!import.meta.env.DEV ? '/api/admin/draw' : `${window.location.protocol}//${window.location.hostname}:${serverPort}/api/admin/draw`);

function DrawAdmin() {
    const [wordsData, setWordsData] = useState({});
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const fileInputRef = useRef(null);

    // Form state
    const [formData, setFormData] = useState({
        word: '',
        hint: '',
        categoryKey: '',
        categoryLabel: '',
        originalWord: ''
    });

    useEffect(() => {
        fetchWords();
    }, []);

    const fetchWords = async () => {
        setIsLoading(true);
        try {
            const token = localStorage.getItem('adminToken');
            const res = await fetch(`${API_URL}/words`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setWordsData(data);
            if (!selectedCategory && Object.keys(data).length > 0) {
                setSelectedCategory(Object.keys(data)[0]);
            }
        } catch (error) {
            console.error('Error fetching words:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleImportJSON = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            const token = localStorage.getItem('adminToken');
            const res = await fetch(`${API_URL}/words/import`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ words: json })
            });
            const result = await res.json();
            if (result.success) {
                alert(`Succès : ${result.imported} mots importés !`);
                fetchWords();
            } else {
                alert(result.error || 'Erreur lors de l\'importation');
            }
        } catch (err) {
            alert('Fichier JSON invalide');
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleExportJSON = () => {
        const token = localStorage.getItem('adminToken');
        fetch(`${API_URL}/words/export`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => res.blob())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `draw_words_${Date.now()}.json`;
            a.click();
        })
        .catch(err => alert('Erreur lors de l\'exportation'));
    };

    const handleAdd = () => {
        setEditMode(false);
        setFormData({
            word: '',
            hint: '',
            categoryKey: selectedCategory,
            categoryLabel: wordsData[selectedCategory]?.[0]?.category || '',
            originalWord: ''
        });
        setShowModal(true);
    };

    const handleEdit = (wordObj) => {
        setEditMode(true);
        setFormData({
            word: wordObj.word,
            hint: wordObj.hint || '',
            categoryKey: selectedCategory,
            categoryLabel: wordObj.category,
            originalWord: wordObj.word
        });
        setShowModal(true);
    };

    const handleDelete = async (word) => {
        if (!window.confirm(`Supprimer le mot "${word}" ?`)) return;

        try {
            const res = await fetch(`${API_URL}/words`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryKey: selectedCategory, word })
            });
            if (res.ok) {
                fetchWords();
            } else {
                alert('Erreur lors de la suppression');
            }
        } catch (error) {
            console.error('Delete error:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const endpoint = `${API_URL}/words`;
        const method = editMode ? 'PUT' : 'POST';

        try {
            const res = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                setShowModal(false);
                fetchWords();
            } else {
                alert('Erreur lors de la sauvegarde');
            }
        } catch (error) {
            console.error('Save error:', error);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header / Toolbar */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-slate-800/60">
                <div className="space-y-1">
                    <h3 className="text-lg font-bold text-slate-200 uppercase tracking-wider font-display m-0">Gestion Draw Up</h3>
                    <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold m-0">
                        Administration de la banque de mots par thèmes
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input 
                        type="file" 
                        accept=".json" 
                        ref={fileInputRef} 
                        onChange={handleImportJSON} 
                        className="hidden" 
                    />
                    <button 
                        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] transition-all rounded-xl text-slate-300 text-xs font-bold uppercase tracking-wider border border-slate-700"
                        onClick={() => fileInputRef.current?.click()}
                        title="Importer un fichier JSON de mots"
                    >
                        <Upload className="w-3.5 h-3.5 text-cyan-400" />
                        Importer JSON
                    </button>
                    <button 
                        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] transition-all rounded-xl text-slate-300 text-xs font-bold uppercase tracking-wider border border-slate-700"
                        onClick={handleExportJSON}
                        title="Exporter la base de mots au format JSON"
                    >
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        Exporter JSON
                    </button>
                    <button 
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-pink-600 hover:bg-pink-500 active:scale-[0.98] transition-all rounded-xl text-white text-xs font-bold uppercase tracking-widest shadow-lg shadow-pink-500/20"
                        onClick={handleAdd}
                    >
                        <Plus className="w-4 h-4" />
                        Ajouter un mot
                    </button>
                </div>
            </div>

            {/* Category Tabs */}
            <div className="flex flex-wrap gap-2 pb-2">
                {Object.keys(wordsData).map(key => (
                    <button
                        key={key}
                        className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl border transition-all active:scale-[0.97] ${
                            selectedCategory === key 
                                ? 'bg-pink-500/10 border-pink-500/80 text-pink-400 font-extrabold shadow-[0_0_12px_rgba(236,72,153,0.1)]' 
                                : 'bg-slate-900/30 border-slate-850 text-slate-400 hover:text-slate-200 hover:border-slate-800'
                        }`}
                        onClick={() => setSelectedCategory(key)}
                    >
                        {key}
                        <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[9px] font-bold ${
                            selectedCategory === key ? 'bg-pink-500/20 text-pink-400' : 'bg-slate-950 text-slate-500'
                        }`}>
                            {wordsData[key].length}
                        </span>
                    </button>
                ))}
            </div>

            {/* Word List Area */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
                    <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                    <span className="text-xs uppercase tracking-widest font-bold">Chargement de la base de mots...</span>
                </div>
            ) : (
                <div className="overflow-hidden border border-slate-850 rounded-2xl bg-slate-950/20">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-850 bg-slate-900/40 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                                    <th className="px-6 py-4">Mot / Phrase</th>
                                    <th className="px-6 py-4">Indice de jeu</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-900/50">
                                {wordsData[selectedCategory]?.map((item, idx) => (
                                    <tr key={idx} className="group hover:bg-slate-900/20 transition-all">
                                        <td className="px-6 py-4 text-sm font-bold text-slate-200 group-hover:text-pink-400 transition-colors">
                                            {item.word}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-400 italic">
                                            {item.hint || '—'}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="inline-flex gap-1.5">
                                                <button
                                                    className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-400 hover:text-cyan-400 rounded-xl transition-all"
                                                    onClick={() => handleEdit(item)}
                                                    title="Éditer le mot"
                                                >
                                                    <Edit2 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    className="p-2 bg-slate-900 hover:bg-red-950/40 border border-slate-850 hover:border-red-500/20 text-slate-400 hover:text-red-400 rounded-xl transition-all"
                                                    onClick={() => handleDelete(item.word)}
                                                    title="Supprimer le mot"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {(!wordsData[selectedCategory] || wordsData[selectedCategory].length === 0) && (
                                    <tr>
                                        <td colSpan="3" className="px-6 py-12 text-center text-slate-500 text-sm font-medium">
                                            Aucun mot disponible dans cette catégorie.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Edit/Add Modal Overlay */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop blur overlay */}
                    <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setShowModal(false)}></div>
                    
                    {/* Modal container */}
                    <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl animate-[fadeIn_0.2s_ease-out]">
                        <div className="flex justify-between items-center bg-slate-900/60 border-b border-slate-850 px-6 py-4">
                            <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-display m-0">
                                {editMode ? 'Modifier le Mot' : 'Ajouter un Mot'}
                            </h4>
                            <button 
                                className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
                                onClick={() => setShowModal(false)}
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <form onSubmit={handleSubmit}>
                            <div className="p-6 space-y-4">
                                <div className="space-y-2">
                                    <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                                        <Type className="w-3.5 h-3.5 text-pink-400" />
                                        Mot / Phrase
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full bg-slate-950 text-white placeholder-slate-700 border border-slate-850 focus:border-pink-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-pink-500/10 transition-all"
                                        value={formData.word}
                                        onChange={e => setFormData({ ...formData, word: e.target.value })}
                                        required
                                        placeholder="ex. Tour Eiffel"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                                        <HelpCircle className="w-3.5 h-3.5 text-pink-400" />
                                        Indice (optionnel)
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full bg-slate-950 text-white placeholder-slate-700 border border-slate-850 focus:border-pink-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-pink-500/10 transition-all"
                                        value={formData.hint}
                                        onChange={e => setFormData({ ...formData, hint: e.target.value })}
                                        placeholder="ex. Monument parisien"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                                        <Bookmark className="w-3.5 h-3.5 text-pink-400" />
                                        Catégorie (Label)
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full bg-slate-950 text-white placeholder-slate-700 border border-slate-850 focus:border-pink-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-pink-500/10 transition-all"
                                        value={formData.categoryLabel}
                                        onChange={e => setFormData({ ...formData, categoryLabel: e.target.value })}
                                        placeholder="ex. Monuments"
                                    />
                                </div>
                            </div>
                            
                            <div className="flex justify-end gap-2 bg-slate-900/40 border-t border-slate-850 px-6 py-4">
                                <button 
                                    type="button" 
                                    className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white transition-colors"
                                    onClick={() => setShowModal(false)}
                                >
                                    Annuler
                                </button>
                                <button 
                                    type="submit" 
                                    className="flex items-center gap-2 px-5 py-2.5 bg-pink-600 hover:bg-pink-500 active:scale-[0.97] text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-pink-500/20"
                                >
                                    <Save className="w-4 h-4" />
                                    Enregistrer
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default DrawAdmin;
