import { useState, useEffect } from 'react';
import { 
    Plus, 
    Edit2, 
    Trash2, 
    Eye, 
    Search, 
    Filter, 
    MapPin, 
    Compass, 
    ArrowRight,
    Loader2,
    X,
    Save
} from 'lucide-react';

const isHttps = window.location.protocol === 'https:';
const serverPort = isHttps ? 3443 : 3005;
const API_URL = import.meta.env.VITE_SERVER_URL 
    ? `${import.meta.env.VITE_SERVER_URL}/api/admin/geo`
    : (!import.meta.env.DEV ? '/api/admin/geo' : `${window.location.protocol}//${window.location.hostname}:${serverPort}/api/admin/geo`);

function GeoAdmin() {
    const [locations, setLocations] = useState([]);
    const [filteredLocations, setFilteredLocations] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editMode, setEditMode] = useState(false);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCountry, setFilterCountry] = useState('All');

    // Form state
    const [formData, setFormData] = useState({
        lat: '',
        lng: '',
        country: '',
        city: '',
        originalCity: ''
    });
    const [mapsUrl, setMapsUrl] = useState('');
    const [isParsingUrl, setIsParsingUrl] = useState(false);

    useEffect(() => {
        fetchLocations();
    }, []);

    useEffect(() => {
        filterData();
    }, [locations, searchTerm, filterCountry]);

    const fetchLocations = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`${API_URL}/locations`);
            const data = await res.json();
            setLocations(data);
        } catch (error) {
            console.error('Error fetching locations:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const filterData = () => {
        let filtered = locations;

        if (filterCountry !== 'All') {
            filtered = filtered.filter(l => l.country === filterCountry);
        }

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            filtered = filtered.filter(l =>
                l.city.toLowerCase().includes(lower) ||
                l.country.toLowerCase().includes(lower)
            );
        }

        setFilteredLocations(filtered);
    };

    // Parse Google Maps URL to extract coordinates
    const parseGoogleMapsUrl = async (url) => {
        if (!url) return;

        setIsParsingUrl(true);

        try {
            let finalUrl = url;

            if (url.includes('maps.app.goo.gl') || url.includes('goo.gl/maps')) {
                try {
                    const expandRes = await fetch(`${API_URL}/expand-url?url=${encodeURIComponent(url)}`);
                    if (expandRes.ok) {
                        const data = await expandRes.json();
                        finalUrl = data.expandedUrl || url;
                    }
                } catch (e) {
                    console.log('Could not expand URL, trying direct parse');
                }
            }

            let lat, lng;

            // Pattern 1: @lat,lng or !3d-lat!4d-lng in URL
            const atPattern = /@(-?\d+\.?\d*),(-?\d+\.?\d*)/;
            const match1 = finalUrl.match(atPattern);
            if (match1) {
                lat = parseFloat(match1[1]);
                lng = parseFloat(match1[2]);
            }

            // Pattern 2: ?ll=lat,lng
            if (!lat) {
                const llPattern = /ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/;
                const match2 = finalUrl.match(llPattern);
                if (match2) {
                    lat = parseFloat(match2[1]);
                    lng = parseFloat(match2[2]);
                }
            }

            // Pattern 3: !3d and !4d patterns (Street View)
            if (!lat) {
                const dPattern = /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/;
                const match3 = finalUrl.match(dPattern);
                if (match3) {
                    lat = parseFloat(match3[1]);
                    lng = parseFloat(match3[2]);
                }
            }

            // Pattern 4: place/.../@lat,lng
            if (!lat) {
                const placePattern = /place\/[^@]*@(-?\d+\.?\d*),(-?\d+\.?\d*)/;
                const match4 = finalUrl.match(placePattern);
                if (match4) {
                    lat = parseFloat(match4[1]);
                    lng = parseFloat(match4[2]);
                }
            }

            if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
                setFormData(prev => ({
                    ...prev,
                    lat: lat.toFixed(6),
                    lng: lng.toFixed(6)
                }));
                setMapsUrl(''); // Clear the URL field on success
            } else {
                alert('Impossible d\'extraire les coordonnées. Essayez de copier l\'URL complète depuis la barre d\'adresse de Google Maps (pas le lien court).');
            }
        } catch (error) {
            console.error('Error parsing Google Maps URL:', error);
            alert('Erreur lors de l\'analyse du lien');
        } finally {
            setIsParsingUrl(false);
        }
    };

    const handleAdd = () => {
        setEditMode(false);
        setFormData({
            lat: '',
            lng: '',
            country: '',
            city: '',
            originalCity: ''
        });
        setMapsUrl('');
        setShowModal(true);
    };

    const handleEdit = (loc) => {
        setEditMode(true);
        setFormData({
            lat: loc.lat,
            lng: loc.lng,
            country: loc.country,
            city: loc.city,
            originalCity: loc.city
        });
        setShowModal(true);
    };

    const handleDelete = async (city) => {
        if (!window.confirm(`Supprimer le lieu "${city}" ?`)) return;

        try {
            const res = await fetch(`${API_URL}/locations`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ city })
            });
            if (res.ok) {
                fetchLocations();
            } else {
                alert('Erreur lors de la suppression');
            }
        } catch (error) {
            console.error('Delete error:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const endpoint = `${API_URL}/locations`;
        const method = editMode ? 'PUT' : 'POST';

        try {
            const res = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                setShowModal(false);
                fetchLocations();
            } else {
                alert('Erreur lors de la sauvegarde');
            }
        } catch (error) {
            console.error('Save error:', error);
        }
    };

    // Derived data
    const countries = ['All', ...new Set(locations.map(l => l.country))].sort();

    return (
        <div className="space-y-6">
            {/* Header / Title */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-slate-800/60">
                <div className="space-y-1">
                    <h3 className="text-lg font-bold text-slate-200 uppercase tracking-wider font-display m-0">Gestion GeoTrackr</h3>
                    <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold m-0">
                        Administration des lieux mystères et coordonnées géographiques
                    </p>
                </div>
                <button 
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 active:scale-[0.98] transition-all rounded-xl text-white text-xs font-bold uppercase tracking-widest shadow-lg shadow-cyan-500/20"
                    onClick={handleAdd}
                >
                    <Plus className="w-4 h-4" />
                    Ajouter un lieu
                </button>
            </div>

            {/* Filter Toolbar */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                <div className="md:col-span-5 relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        className="w-full bg-slate-900/60 text-white placeholder-slate-650 border border-slate-800 focus:border-cyan-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none transition-all"
                        placeholder="Rechercher une ville..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="md:col-span-4 relative">
                    <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <select
                        className="w-full bg-slate-900/60 text-slate-300 border border-slate-800 focus:border-cyan-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none transition-all appearance-none cursor-pointer"
                        value={filterCountry}
                        onChange={e => setFilterCountry(e.target.value)}
                    >
                        {countries.map(c => <option key={c} value={c}>{c === 'All' ? 'Tous les pays' : c}</option>)}
                    </select>
                </div>
                <div className="md:col-span-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-widest">
                    Filtré : {filteredLocations.length} / {locations.length}
                </div>
            </div>

            {/* Locations List */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
                    <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
                    <span className="text-xs uppercase tracking-widest font-bold">Chargement de la base géographique...</span>
                </div>
            ) : (
                <div className="overflow-hidden border border-slate-850 rounded-2xl bg-slate-950/20">
                    <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-slate-900 z-10">
                                <tr className="border-b border-slate-850 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                                    <th className="px-6 py-4 bg-slate-900">Ville / Lieu</th>
                                    <th className="px-6 py-4 bg-slate-900">Pays</th>
                                    <th className="px-6 py-4 bg-slate-900">Latitude</th>
                                    <th className="px-6 py-4 bg-slate-900">Longitude</th>
                                    <th className="px-6 py-4 bg-slate-900 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-900/50">
                                {filteredLocations.map((item, idx) => (
                                    <tr key={idx} className="group hover:bg-slate-900/20 transition-all">
                                        <td className="px-6 py-4 text-sm font-bold text-slate-200 group-hover:text-cyan-400 transition-colors">
                                            {item.city}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-cyan-400 font-semibold">
                                            {item.country}
                                        </td>
                                        <td className="px-6 py-4 text-xs font-mono text-slate-500">
                                            {item.lat}
                                        </td>
                                        <td className="px-6 py-4 text-xs font-mono text-slate-500">
                                            {item.lng}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="inline-flex gap-1.5">
                                                <button
                                                    className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-400 hover:text-cyan-400 rounded-xl transition-all"
                                                    onClick={() => handleEdit(item)}
                                                    title="Éditer"
                                                >
                                                    <Edit2 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    className="p-2 bg-slate-900 hover:bg-red-950/40 border border-slate-850 hover:border-red-500/20 text-slate-400 hover:text-red-400 rounded-xl transition-all"
                                                    onClick={() => handleDelete(item.city)}
                                                    title="Supprimer"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                                <a
                                                    href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${item.lat},${item.lng}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-400 hover:text-amber-400 rounded-xl transition-all"
                                                    title="Visualiser sur Google Maps (Street View)"
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                </a>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filteredLocations.length === 0 && (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center text-slate-500 text-sm font-medium">
                                            Aucun lieu trouvé.
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
                    <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl animate-[fadeIn_0.2s_ease-out]">
                        <div className="flex justify-between items-center bg-slate-900/60 border-b border-slate-850 px-6 py-4">
                            <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-display m-0">
                                {editMode ? 'Modifier le Lieu' : 'Ajouter un Lieu'}
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
                                    <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                                        Ville / Nom du Lieu
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full bg-slate-950 text-white placeholder-slate-700 border border-slate-850 focus:border-cyan-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-cyan-500/10 transition-all"
                                        value={formData.city}
                                        onChange={e => setFormData({ ...formData, city: e.target.value })}
                                        required
                                        placeholder="ex. Paris"
                                    />
                                </div>
                                
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                                        Pays
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full bg-slate-950 text-white placeholder-slate-700 border border-slate-850 focus:border-cyan-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-cyan-500/10 transition-all"
                                        value={formData.country}
                                        onChange={e => setFormData({ ...formData, country: e.target.value })}
                                        required
                                        placeholder="ex. France"
                                    />
                                </div>

                                {/* Google Maps URL Parser */}
                                {!editMode && (
                                    <div className="p-4 bg-cyan-950/20 border border-cyan-500/20 rounded-xl space-y-3">
                                        <label className="flex items-center gap-1.5 text-[10px] font-black tracking-widest text-cyan-400 uppercase m-0">
                                            <MapPin className="w-4 h-4 animate-bounce" />
                                            Coller un lien Google Maps (optionnel)
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                className="w-full bg-slate-950 text-white placeholder-slate-700 border border-slate-850 focus:border-cyan-500 rounded-xl px-3 py-2 text-xs focus:outline-none transition-all"
                                                placeholder="https://maps.app.goo.gl/... ou URL de la barre d'adresse"
                                                value={mapsUrl}
                                                onChange={e => setMapsUrl(e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 active:scale-[0.97] disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all"
                                                onClick={() => parseGoogleMapsUrl(mapsUrl)}
                                                disabled={!mapsUrl || isParsingUrl}
                                            >
                                                {isParsingUrl ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : 'Extraire'}
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-slate-500 italic m-0">
                                            Extrait automatiquement la latitude et la longitude à partir de l'URL Google Maps.
                                        </p>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-450 uppercase">
                                            <Compass className="w-3.5 h-3.5 text-cyan-400" />
                                            Latitude
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            className="w-full bg-slate-950 text-white border border-slate-850 focus:border-cyan-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-cyan-500/10 transition-all font-mono"
                                            value={formData.lat}
                                            onChange={e => setFormData({ ...formData, lat: e.target.value })}
                                            required
                                            placeholder="48.8566"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-450 uppercase">
                                            <Compass className="w-3.5 h-3.5 text-cyan-400" />
                                            Longitude
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            className="w-full bg-slate-950 text-white border border-slate-850 focus:border-cyan-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-cyan-500/10 transition-all font-mono"
                                            value={formData.lng}
                                            onChange={e => setFormData({ ...formData, lng: e.target.value })}
                                            required
                                            placeholder="2.3522"
                                        />
                                    </div>
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
                                    className="flex items-center gap-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 active:scale-[0.97] text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-cyan-500/20"
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

export default GeoAdmin;
