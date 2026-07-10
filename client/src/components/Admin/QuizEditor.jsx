import { useState } from 'react';
import { apiBase } from '../Quiz/quizShared';
import { 
    Trash2, 
    Plus, 
    Save, 
    X, 
    HelpCircle, 
    Sparkles, 
    Image as ImageIcon, 
    Gauge, 
    MessageSquare,
    CheckCircle
} from 'lucide-react';

function QuizEditor({ quiz, onSave, onCancel }) {
    const [title, setTitle] = useState(quiz ? quiz.title : '');
    const [description, setDescription] = useState(quiz ? quiz.description : '');
    const [questions, setQuestions] = useState(quiz ? quiz.questions : []);

    const handleAddQuestion = () => {
        setQuestions([...questions, {
            text: "Nouvelle Question",
            image: "",
            options: ["Option 1", "Option 2", "Option 3", "Option 4"],
            correct: 0,
            difficulty: 3,
            explanation: ""
        }]);
    };

    const handleQuestionChange = (index, field, value) => {
        const newQuestions = [...questions];
        newQuestions[index][field] = value;
        setQuestions(newQuestions);
    };

    const handleOptionChange = (qIndex, oIndex, value) => {
        const newQuestions = [...questions];
        newQuestions[qIndex].options[oIndex] = value;
        setQuestions(newQuestions);
    };

    const handleDeleteQuestion = (index) => {
        const newQuestions = questions.filter((_, i) => i !== index);
        setQuestions(newQuestions);
    };

    const handleSave = async () => {
        const quizData = { title, description, questions };
        const url = `${apiBase()}/quizzes` + (quiz ? `/${quiz.id}` : '');
        const method = quiz ? 'PUT' : 'POST';

        try {
            await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(quizData)
            });
            onSave();
        } catch (error) {
            console.error("Erreur sauvegarde:", error);
            alert("Erreur lors de la sauvegarde");
        }
    };

    return (
        <div className="space-y-8 pb-32">
            {/* Header Title */}
            <div className="flex justify-between items-center pb-4 border-b border-slate-800/60">
                <div>
                    <h2 className="text-xl md:text-2xl font-black tracking-widest bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent font-display uppercase m-0">
                        {quiz ? "Éditer le Quiz" : "Nouveau Quiz"}
                    </h2>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest m-0 mt-1 font-semibold">
                        Configuration des questions et métadonnées
                    </p>
                </div>
            </div>

            {/* Quiz Info Card */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase">Titre du Quiz</label>
                        <input 
                            className="w-full bg-slate-950 text-white placeholder-slate-700 border border-slate-850 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all duration-300" 
                            value={title} 
                            placeholder="ex. Quiz Pop Culture"
                            onChange={e => setTitle(e.target.value)} 
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase">Description</label>
                        <input 
                            className="w-full bg-slate-950 text-white placeholder-slate-700 border border-slate-850 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all duration-300" 
                            value={description} 
                            placeholder="ex. Testez vos connaissances sur le cinéma et la musique"
                            onChange={e => setDescription(e.target.value)} 
                        />
                    </div>
                </div>
            </div>

            {/* Questions Section Header */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-base font-bold text-slate-200 uppercase tracking-wider font-display m-0">
                        Questions ({questions.length})
                    </h3>
                </div>
            </div>

            {/* Questions List */}
            <div className="space-y-6">
                {questions.map((q, qIdx) => (
                    <div key={qIdx} className="group relative bg-slate-900/20 border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-all">
                        {/* Question Card Header */}
                        <div className="flex justify-between items-center bg-slate-900/40 border-b border-slate-800/80 px-6 py-4">
                            <span className="text-sm font-bold text-slate-300 uppercase tracking-wider font-display">
                                Question {qIdx + 1}
                            </span>
                            <button 
                                className="p-2 bg-red-950/20 hover:bg-red-900/30 border border-red-500/10 hover:border-red-500/30 text-red-400 rounded-xl transition-all active:scale-[0.97]"
                                onClick={() => handleDeleteQuestion(qIdx)}
                                title="Supprimer la question"
                            >
                                <Trash2 className="w-4.5 h-4.5" />
                            </button>
                        </div>

                        {/* Question Card Body */}
                        <div className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="block text-[10px] font-bold tracking-widest text-slate-500 uppercase">Intitulé de la question</label>
                                <input 
                                    className="w-full bg-slate-950 text-white border border-slate-850 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all" 
                                    value={q.text} 
                                    onChange={e => handleQuestionChange(qIdx, 'text', e.target.value)} 
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="md:col-span-2 space-y-2">
                                    <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                                        <ImageIcon className="w-3.5 h-3.5" />
                                        URL de l'image (Optionnel)
                                    </label>
                                    <input 
                                        className="w-full bg-slate-950 text-white placeholder-slate-800 border border-slate-850 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all" 
                                        value={q.image || ''} 
                                        placeholder="https://..."
                                        onChange={e => handleQuestionChange(qIdx, 'image', e.target.value)} 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                                        <Gauge className="w-3.5 h-3.5" />
                                        Difficulté (QI)
                                    </label>
                                    <select 
                                        className="w-full bg-slate-950 text-slate-300 border border-slate-850 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all"
                                        value={q.difficulty ?? 3}
                                        onChange={e => handleQuestionChange(qIdx, 'difficulty', Number(e.target.value))}
                                    >
                                        <option value={1}>1 · Très facile</option>
                                        <option value={2}>2 · Facile</option>
                                        <option value={3}>3 · Moyen</option>
                                        <option value={4}>4 · Difficile</option>
                                        <option value={5}>5 · Très difficile</option>
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    Explication (affichée après la réponse)
                                </label>
                                <textarea 
                                    className="w-full bg-slate-950 text-white placeholder-slate-700 border border-slate-850 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all" 
                                    rows={2}
                                    value={q.explanation || ''} 
                                    onChange={e => handleQuestionChange(qIdx, 'explanation', e.target.value)}
                                    placeholder="Pourquoi cette réponse est la bonne…" 
                                />
                            </div>

                            {/* Options Grid */}
                            <div className="space-y-2 pt-2">
                                <label className="block text-[10px] font-bold tracking-widest text-slate-500 uppercase">Options de réponses (Sélectionnez la bonne)</label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {q.options.map((opt, oIdx) => (
                                        <div 
                                            key={oIdx} 
                                            className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all ${
                                                q.correct === oIdx 
                                                    ? 'bg-emerald-950/20 border-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.06)]' 
                                                    : 'bg-slate-950/40 border-slate-850'
                                            }`}
                                        >
                                            <input
                                                type="radio"
                                                id={`correct-${qIdx}-${oIdx}`}
                                                name={`correct-${qIdx}`}
                                                checked={q.correct === oIdx}
                                                onChange={() => handleQuestionChange(qIdx, 'correct', oIdx)}
                                                className="w-4 h-4 text-emerald-600 bg-slate-900 border-slate-800 focus:ring-emerald-500 focus:ring-offset-0 focus:ring-2 cursor-pointer"
                                            />
                                            <input
                                                className={`w-full bg-transparent border-0 text-sm focus:outline-none focus:ring-0 p-0 text-slate-200 ${
                                                    q.correct === oIdx ? 'text-emerald-400 placeholder-emerald-700 font-bold' : ''
                                                }`}
                                                value={opt}
                                                onChange={e => handleOptionChange(qIdx, oIdx, e.target.value)}
                                                placeholder={`Option ${oIdx + 1}`}
                                            />
                                            {q.correct === oIdx && (
                                                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Add Question Button */}
            <button 
                className="w-full flex items-center justify-center gap-2 py-4 border-2 border-dashed border-slate-800 hover:border-emerald-500/40 text-slate-500 hover:text-emerald-400 bg-slate-900/5 hover:bg-emerald-500/5 rounded-2xl transition-all font-display text-sm tracking-wider uppercase font-bold"
                onClick={handleAddQuestion}
            >
                <Plus className="w-5 h-5 animate-pulse" />
                Ajouter une question
            </button>

            {/* Bottom Fixed Action Bar */}
            <div className="fixed bottom-0 inset-x-0 bg-slate-950/60 backdrop-blur-md border-t border-slate-900/80 p-4 z-40">
                <div className="max-w-7xl mx-auto flex gap-3 justify-center">
                    <button 
                        className="flex items-center justify-center gap-2 px-8 py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition-all rounded-xl text-white text-xs font-bold uppercase tracking-wider shadow-lg shadow-emerald-500/20"
                        onClick={handleSave}
                    >
                        <Save className="w-4.5 h-4.5" />
                        Sauvegarder
                    </button>
                    <button 
                        className="flex items-center justify-center gap-2 px-8 py-3 bg-slate-900 hover:bg-slate-850 active:scale-[0.98] border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-all rounded-xl text-xs font-bold uppercase tracking-wider"
                        onClick={onCancel}
                    >
                        <X className="w-4.5 h-4.5" />
                        Annuler
                    </button>
                </div>
            </div>
        </div>
    );
}

export default QuizEditor;
