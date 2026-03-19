import { useEffect, useRef, useState } from 'react';

const buildUrl = (endpoint, params) => {
  const search = new URLSearchParams(params);
  return `${endpoint}?${search.toString()}`;
};

const useStream = ({
  query,
  userId,
  endpoint = '/stream/insights',
  enabled = true,
}) => {
  const [events, setEvents] = useState([]);
  const [latest, setLatest] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const sourceRef = useRef(null);

  useEffect(() => {
    if (!enabled || !query || !userId) {
      return undefined;
    }

    const url = buildUrl(endpoint, { query, user_id: userId });
    const source = new EventSource(url);
    sourceRef.current = source;
    setStatus('connecting');

    source.onopen = () => {
      setStatus('open');
    };

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        setEvents((prev) => [...prev, payload]);
        setLatest(payload);

        if (payload.event === 'summary') {
          setStatus('complete');
          source.close();
        }
      } catch (err) {
        setError(err);
        setStatus('error');
      }
    };

    source.onerror = () => {
      setStatus('error');
      setError(new Error('Stream error'));
      source.close();
    };

    return () => {
      source.close();
    };
  }, [query, userId, endpoint, enabled]);

  const reset = () => {
    setEvents([]);
    setLatest(null);
    setError(null);
    setStatus('idle');
  };

  return {
    events,
    latest,
    status,
    error,
    reset,
  };
};

export default useStream;
