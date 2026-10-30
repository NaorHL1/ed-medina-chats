'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface ChatRow {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
}

export default function Chats() {
  const [chats, setChats] = useState<ChatRow[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/chats').then(async (response) => {
      if (response.status === 401) return setSignedOut(true);
      const body = (await response.json()) as { chats: ChatRow[] };
      setChats(body.chats);
    });
  }, []);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  async function deleteEverything() {
    if (!window.confirm('Delete every chat and report? This cannot be undone.')) return;
    const response = await fetch('/api/me', { method: 'DELETE' });
    if (response.ok) window.location.href = '/login';
    else setMessage('Could not delete. Try again.');
  }

  if (signedOut) {
    return (
      <main className="shell">
        <p>Please <Link href="/login">sign in</Link> first.</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <h1>Your chats</h1>
      <p><Link href="/">Upload a new chat</Link></p>
      {chats === null && <p>Loading...</p>}
      {chats?.length === 0 && <p>No chats yet.</p>}
      <ul>
        {chats?.map((chat) => (
          <li key={chat.id}>
            <Link href={`/chats/${chat.id}`}>{chat.title}</Link> · {chat.messageCount} messages
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" onClick={signOut}>Sign out</button>
        <button type="button" onClick={deleteEverything}>Delete everything</button>
      </div>
      {message && <p role="alert">{message}</p>}
    </main>
  );
}
