import { useCallback, useEffect, useState } from 'react';
import type { Ticket } from '../../shared/types';
import { useStation } from '../context';
import { api } from './api';
import { useLocal } from './hooks';

export function useCurrentTicket() {
  const { event, station } = useStation(),
    [id, setId] = useLocal<string | null>(`framerelay.v1.${event.id}.${station}.ticket`, null),
    [ticket, setTicket] = useState<Ticket | null>(null),
    [loadError, setLoadError] = useState('');
  useEffect(() => {
    if (!id) {
      setTicket(null);
      return;
    }
    let active = true;
    const load = () =>
      api<Ticket>(`/tickets/${id}`)
        .then((result) => {
          if (active) {
            setTicket((current) =>
              !current || current.id !== result.id || result.revision >= current.revision
                ? result
                : current,
            );
            setLoadError('');
          }
        })
        .catch((e) => {
          if (active) setLoadError(e.message);
        });
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);
  const update = useCallback(
    (value: Ticket | null) => {
      setTicket((current) =>
        !current || !value || current.id !== value.id || value.revision >= current.revision
          ? value
          : current,
      );
      setId(value?.id ?? null);
      setLoadError('');
    },
    [setId],
  );
  return {
    ticket,
    setTicket: update,
    loadError,
    refresh: async () => {
      if (id) {
        const next = await api<Ticket>(`/tickets/${id}`);
        setTicket(next);
        return next;
      }
      return null;
    },
  };
}
