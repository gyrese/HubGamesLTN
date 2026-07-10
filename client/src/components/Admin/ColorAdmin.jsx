import { useState, useEffect } from 'react';
import { 
    Plus, 
    Edit2, 
    Trash2, 
    Loader2, 
    Palette, 
    Search,
    Compass,
    Image as ImageIcon,
    Tag,
    Layers,
    Save,
    X,
    Sparkles
} from 'lucide-react';
import ColorImageStudio from './ColorImageStudio';
import { CATEGORY_ORDER } from '../Color/colorCategories';

const isHttps = window.location.protocol === 'https:';
const serverPort = isHttps ? 3443 : 3005;
const API_URL = import.meta.env.VITE_SERVER_URL 
    ? `${import.meta.env.VITE_SERVER_URL}/api`
    : (!import.meta.env.DEV ? '/api' : `${window.location.protocol}//${window.location.hostname}:${serverPort}/api`);

function ColorAdmin() {
    const [characters, setCharacters] = useState([]);
    const [formCharacter, setFormCharacter] = useState({
        id: '',
        name: '',
        part: '',
        source: '',
        category: '',
        target_h: 0,
        target_s: 0,
        target_b: 0,
        image_path: ''
    });
    
    const [imageFile, setImageFile] = useState(null);
    const [processedBlob, setProcessedBlob] = useState(null); // WebP détouré exporté par le studio
    const [isEditing, setIsEditing] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sortBy, setSortBy] = useState(null); // null, 'name', 'source', 'category'
    const [sortOrder, setSortOrder] = useState('asc'); // 'asc', 'desc'

    const handleSort = (field) => {
        if (sortBy === field) {
            if (sortOrder === 'asc') {
                setSortOrder('desc');
            } else {
                setSortBy(null);
                setSortOrder('asc');
            }
        } else {
            setSortBy(field);
            setSortOrder('asc');
        }
    };

    const sortedCharacters = [...characters].sort((a, b) => {
        if (!sortBy) return 0;
        let valA = a[sortBy] || '';
        let valB = b[sortBy] || '';
        valA = valA.toString().toLowerCase();
        valB = valB.toString().toLowerCase();
        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
    });

    useEffect(() => {
        fetchCharacters();
    }, []);

    const fetchCharacters = async () => {
        try {
            const res = await fetch(`${API_URL}/color/characters`);
            if (res.ok) {
                const data = await res.json();
                setCharacters(data);
            } else {
                setError('Erreur lors du chargement des personnages');
            }
        } catch (err) {
            console.error(err);
            setError('Erreur réseau lors du chargement des personnages');
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormCharacter(prev => ({
            ...prev,
            [name]: ['target_h', 'target_s', 'target_b'].includes(name) ? parseInt(value) || 0 : value
        }));
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            setImageFile(e.target.files[0]);
            setProcessedBlob(null); // sera regénéré par le studio
        }
    };

    const handleStudioChange = ({ blob, hsb }) => {
        if (blob) setProcessedBlob(blob);
        if (hsb) setFormCharacter(prev => ({
            ...prev, target_h: hsb.h, target_s: hsb.s, target_b: hsb.b
        }));
    };

    const handleReset = () => {
        setFormCharacter({
            id: '',
            name: '',
            part: '',
            source: '',
            category: '',
            target_h: 0,
            target_s: 0,
            target_b: 0,
            image_path: ''
        });
        setImageFile(null);
        setProcessedBlob(null);
        setIsEditing(false);
        setError('');
        setSuccess('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setIsLoading(true);

        const { id, name, part, source, category, target_h, target_s, target_b, image_path } = formCharacter;

        if (!id.trim() || !name.trim() || !part.trim() || !source.trim()) {
            setError('Tous les champs texte sont requis');
            setIsLoading(false);
            return;
        }

        try {
            let finalImagePath = image_path;

            if (processedBlob || imageFile) {
                const formData = new FormData();
                if (processedBlob) {
                    formData.append('image', processedBlob, `${id.trim() || 'char'}.webp`);
                } else {
                    formData.append('image', imageFile);
                }

                const uploadRes = await fetch(`${API_URL}/admin/color/upload`, {
                    method: 'POST',
                    body: formData
                });

                if (!uploadRes.ok) {
                    const errData = await uploadRes.json();
                    throw new Error(errData.error || "Erreur lors de l'upload du fichier WebP");
                }

                const uploadData = await uploadRes.json();
                finalImagePath = uploadData.url;
            }

            if (!finalImagePath && !isEditing) {
                throw new Error("L'image est requise lors de la création d'un nouveau personnage");
            }

            const characterData = {
                id: id.trim(),
                name: name.trim(),
                part: part.trim(),
                source: source.trim(),
                category: (category || '').trim(),
                target_h: parseInt(target_h),
                target_s: parseInt(target_s),
                target_b: parseInt(target_b),
                image_path: finalImagePath
            };

            const saveUrl = isEditing 
                ? `${API_URL}/admin/color/characters/${id}`
                : `${API_URL}/admin/color/characters`;
            const saveMethod = isEditing ? 'PUT' : 'POST';

            const saveRes = await fetch(saveUrl, {
                method: saveMethod,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(characterData)
            });

            if (!saveRes.ok) {
                const errData = await saveRes.json();
                throw new Error(errData.error || "Erreur lors de l'enregistrement du personnage");
            }

            setSuccess(isEditing ? 'Personnage mis à jour avec succès !' : 'Personnage créé avec succès !');
            handleReset();
            fetchCharacters();
        } catch (err) {
            console.error(err);
            setError(err.message || "Une erreur est survenue");
        } finally {
            setIsLoading(false);
        }
    };

    const handleEdit = (char) => {
        setFormCharacter(char);
        setIsEditing(true);
        setError('');
        setSuccess('');
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Voulez-vous vraiment supprimer ce personnage ?")) return;

        setError('');
        setSuccess('');

        try {
            const res = await fetch(`${API_URL}/admin/color/characters/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                setSuccess('Personnage supprimé !');
                fetchCharacters();
                if (formCharacter.id === id) {
                    handleReset();
                }
            } else {
                const errData = await res.json();
                setError(errData.error || 'Erreur lors de la suppression');
            }
        } catch (err) {
            console.error(err);
            setError('Erreur réseau lors de la suppression');
        }
    };

    const getTargetColorStyle = (h, s, b) => {
        const v = b / 100;
        const sHsb = s / 100;
        const l = v * (1 - sHsb / 2);
        const sHsl = (l === 0 || l === 1) ? 0 : (v - l) / Math.min(l, 1 - l);
        return `hsl(${h}, ${Math.round(sHsl * 100)}%, ${Math.round(l * 100)}%)`;
    };

    const getImageUrl = (imagePath) => {
        if (!imagePath) return '';
        if (imagePath.startsWith('http') || imagePath.startsWith('data:')) return imagePath;
        const base = import.meta.env.VITE_SERVER_URL 
            ? import.meta.env.VITE_SERVER_URL 
            : (!import.meta.env.DEV ? '' : `${window.location.protocol}//${window.location.hostname}:${serverPort}`);
        return `${base}${imagePath}`;
    };

    const categoryOptions = Array.from(new Set([
        ...CATEGORY_ORDER,
        ...characters.map(c => c.category).filter(Boolean)
    ]));

    return (
        <div className="space-y-6">
            {/* Header Title */}
            <div className="flex justify-between items-center pb-4 border-b border-slate-800/60">
                <div className="space-y-1">
                    <h3 className="text-lg font-bold text-slate-200 uppercase tracking-wider font-display m-0">Couleur Moi</h3>
                    <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold m-0">
                        Administration des personnages et calibrage chromatique
                    </p>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-950/20 border border-red-500/20 text-red-400 text-xs font-semibold rounded-xl animate-shake">
                    {error}
                </div>
            )}
            {success && (
                <div className="p-4 bg-emerald-950/20 border border-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-xl">
                    {success}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* 1. Form Editor Column */}
                <div className="lg:col-span-4 bg-slate-900/40 border border-slate-850 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-850">
                        <Palette className="w-4.5 h-4.5 text-amber-400" />
                        <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-display m-0">
                            {isEditing ? 'Éditer le Personnage' : 'Ajouter un Personnage'}
                        </h4>
                    </div>
                    
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase">Identifiant Unique (ID)</label>
                            <input 
                                type="text" 
                                name="id" 
                                value={formCharacter.id}
                                onChange={handleInputChange} 
                                disabled={isEditing}
                                placeholder="ex. pikachu-skin" 
                                className="w-full bg-slate-950 text-white border border-slate-850 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-all disabled:opacity-50"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase">Nom du Personnage</label>
                            <input 
                                type="text" 
                                name="name" 
                                value={formCharacter.name}
                                onChange={handleInputChange} 
                                placeholder="ex. Pikachu"
                                className="w-full bg-slate-950 text-white border border-slate-850 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-all"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase">Partie à colorer</label>
                            <input 
                                type="text" 
                                name="part" 
                                value={formCharacter.part}
                                onChange={handleInputChange} 
                                placeholder="ex. La peau"
                                className="w-full bg-slate-950 text-white border border-slate-850 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-all"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase">Source / Oeuvre d'origine</label>
                            <input
                                type="text" 
                                name="source" 
                                value={formCharacter.source}
                                onChange={handleInputChange} 
                                placeholder="ex. Pokémon"
                                className="w-full bg-slate-950 text-white border border-slate-850 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-all"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase">Univers / Catégorie</label>
                            <input
                                type="text" 
                                name="category" 
                                value={formCharacter.category || ''}
                                onChange={handleInputChange} 
                                placeholder="ex. Nintendo" 
                                list="color-category-options"
                                className="w-full bg-slate-950 text-white border border-slate-850 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-all"
                            />
                            <datalist id="color-category-options">
                                {categoryOptions.map(cat => <option key={cat} value={cat} />)}
                            </datalist>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                                <label className="block text-[9px] font-bold tracking-wider text-slate-550 uppercase">Teinte (H)</label>
                                <input 
                                    type="number" 
                                    min="0" 
                                    max="360" 
                                    name="target_h" 
                                    value={formCharacter.target_h}
                                    onChange={handleInputChange} 
                                    className="w-full bg-slate-950 text-white border border-slate-850 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-amber-500 text-center font-mono"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="block text-[9px] font-bold tracking-wider text-slate-550 uppercase">Sat (S %)</label>
                                <input 
                                    type="number" 
                                    min="0" 
                                    max="100" 
                                    name="target_s" 
                                    value={formCharacter.target_s}
                                    onChange={handleInputChange} 
                                    className="w-full bg-slate-950 text-white border border-slate-850 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-amber-500 text-center font-mono"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="block text-[9px] font-bold tracking-wider text-slate-550 uppercase">Lum (B %)</label>
                                <input 
                                    type="number" 
                                    min="0" 
                                    max="100" 
                                    name="target_b" 
                                    value={formCharacter.target_b}
                                    onChange={handleInputChange} 
                                    className="w-full bg-slate-950 text-white border border-slate-850 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-amber-500 text-center font-mono"
                                />
                            </div>
                        </div>

                        {/* Color Target Swatch Preview */}
                        <div className="flex items-center gap-2.5 p-2.5 bg-slate-950/80 border border-slate-850 rounded-xl">
                            <div 
                                className="w-8 h-8 rounded-lg shadow-inner shrink-0 border border-white/10"
                                style={{
                                    backgroundColor: getTargetColorStyle(formCharacter.target_h, formCharacter.target_s, formCharacter.target_b)
                                }}
                            />
                            <div className="space-y-0.5">
                                <span className="block text-[9px] font-bold tracking-wider text-slate-500 uppercase">Couleur Cible</span>
                                <span className="block text-[10px] font-bold font-mono text-amber-400">
                                    HSL({formCharacter.target_h}, {formCharacter.target_s}%, {formCharacter.target_b}%)
                                </span>
                            </div>
                        </div>

                        {/* Image Detourage Studio Container */}
                        <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase">Image source (Détourage intégré)</label>
                            <input
                                type="file" 
                                accept="image/*" 
                                onChange={handleFileChange}
                                className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-amber-600/10 file:text-amber-400 hover:file:bg-amber-600/20 file:cursor-pointer"
                            />
                            {formCharacter.image_path && !imageFile && (
                                <div className="text-[10px] text-slate-500 italic truncate pt-1">
                                    Fichier : {formCharacter.image_path.split('/').pop()}
                                </div>
                            )}
                            {imageFile && (
                                <ColorImageStudio
                                    file={imageFile}
                                    target={{ h: formCharacter.target_h, s: formCharacter.target_s, b: formCharacter.target_b }}
                                    part={formCharacter.part}
                                    apiUrl={API_URL.replace('/admin/color', '')}
                                    onChange={handleStudioChange}
                                />
                            )}
                        </div>

                        {/* Submit Actions */}
                        <div className="flex gap-2 pt-2">
                            <button 
                                type="submit" 
                                disabled={isLoading} 
                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500 active:scale-[0.97] transition-all rounded-xl text-white text-xs font-bold uppercase tracking-wider shadow-lg shadow-amber-500/10"
                            >
                                {isLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Save className="w-4 h-4" />
                                )}
                                Enregistrer
                            </button>
                            <button 
                                type="button" 
                                onClick={handleReset} 
                                className="px-4 py-2.5 bg-slate-950 hover:bg-slate-900 border border-slate-850 hover:border-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                            >
                                Annuler
                            </button>
                        </div>
                    </form>
                </div>

                {/* 2. Character List Table Column */}
                <div className="lg:col-span-8 overflow-hidden border border-slate-850 rounded-2xl bg-slate-950/20">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-850 bg-slate-900/40 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                                    <th className="px-6 py-4">Aperçu</th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-amber-400 transition-colors select-none" onClick={() => handleSort('name')}>
                                        Nom du personnage {sortBy === 'name' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                                    </th>
                                    <th className="px-6 py-4">Partie cible</th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-amber-400 transition-colors select-none" onClick={() => handleSort('source')}>
                                        Source {sortBy === 'source' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-amber-400 transition-colors select-none" onClick={() => handleSort('category')}>
                                        Univers {sortBy === 'category' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                                    </th>
                                    <th className="px-6 py-4">Teinte HSB</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-900/50 align-middle">
                                {sortedCharacters.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="px-6 py-12 text-center text-slate-500 text-sm font-medium">
                                            Aucun personnage disponible.
                                        </td>
                                    </tr>
                                ) : (
                                    sortedCharacters.map(char => (
                                        <tr key={char.id} className="group hover:bg-slate-900/20 transition-all">
                                            <td className="px-6 py-3">
                                                <div 
                                                    className="relative w-12 h-12 rounded-xl overflow-hidden border border-slate-850 flex items-center justify-center"
                                                    style={{
                                                        background: `
                                                            linear-gradient(rgba(15, 23, 42, 0.4), rgba(15, 23, 42, 0.4)),
                                                            repeating-conic-gradient(#202535 0% 25%, #151825 0% 50%) 50% / 10px 10px
                                                        `
                                                    }}
                                                >
                                                    {/* Color target fill beneath transparent image */}
                                                    <div 
                                                        className="absolute inset-0 opacity-80"
                                                        style={{ backgroundColor: getTargetColorStyle(char.target_h, char.target_s, char.target_b) }}
                                                    />
                                                    <img 
                                                        src={getImageUrl(char.image_path)} 
                                                        alt={char.name}
                                                        className="w-10 h-10 object-contain relative z-10"
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-6 py-3">
                                                <span className="block text-sm font-bold text-slate-200 group-hover:text-amber-400 transition-colors">
                                                    {char.name}
                                                </span>
                                                <span className="block text-[9px] font-mono text-slate-500 uppercase mt-0.5">
                                                    ID: {char.id}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-sm text-slate-300">
                                                {char.part}
                                            </td>
                                            <td className="px-6 py-3 text-sm text-slate-400 font-medium">
                                                {char.source}
                                            </td>
                                            <td className="px-6 py-3">
                                                {char.category ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                                        {char.category}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-600 text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-3">
                                                <span className="inline-flex items-center px-2 py-1 rounded-lg bg-slate-900 border border-slate-850 text-slate-400 font-mono text-[10px] font-bold">
                                                    H:{char.target_h} S:{char.target_s}% B:{char.target_b}%
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                <div className="inline-flex gap-1.5">
                                                    <button 
                                                        onClick={() => handleEdit(char)} 
                                                        className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-400 hover:text-cyan-400 rounded-xl transition-all"
                                                        title="Éditer"
                                                    >
                                                        <Edit2 className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDelete(char.id)} 
                                                        className="p-2 bg-slate-900 hover:bg-red-950/40 border border-slate-850 hover:border-red-500/20 text-slate-400 hover:text-red-400 rounded-xl transition-all"
                                                        title="Supprimer"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
}

export default ColorAdmin;
