import { useEffect, useRef, useState } from 'react';

/**
 * Compte à rebours de la phase en cours.
 *
 * Le serveur envoie un **restant** et non une échéance absolue : les horloges des
 * téléphones du bar ne sont pas synchronisées, et une échéance absolue ferait
 * dériver l'affichage. On décompte localement à partir de chaque instantané reçu,
 * qui resynchronise au passage.
 */
export function usePhaseTimer(remainingMs, duration) {
    const [left, setLeft] = useState(remainingMs || 0);
    const startedAt = useRef(0);
    const base = useRef(0);

    useEffect(() => {
        base.current = remainingMs || 0;
        startedAt.current = Date.now();
        setLeft(base.current);

        if (!remainingMs) return undefined;

        const interval = setInterval(() => {
            const elapsed = Date.now() - startedAt.current;
            setLeft(Math.max(0, base.current - elapsed));
        }, 200);

        return () => clearInterval(interval);
    }, [remainingMs]);

    const seconds = Math.ceil(left / 1000);
    const ratio = duration > 0 ? Math.max(0, Math.min(1, left / duration)) : 0;
    return { ms: left, seconds, ratio, urgent: seconds <= 5 && left > 0 };
}
