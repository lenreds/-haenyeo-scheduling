import React, { useState } from "react";
import { supabase } from "../lib/supabase.js";

// Manager-only login. No self-signup — accounts are created by hand in the
// Supabase dashboard (Authentication -> Users).
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message);
    // On success the onAuthStateChange listener in App swaps this out.
  }

  return (
    <div className="login-wrap">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Manrope:wght@500;700;800&display=swap');
        .login-wrap { font-family: 'Manrope', sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center;
          background: radial-gradient(ellipse at top, #26241f 0%, #1a1815 60%, #151310 100%); color: #EDE7D9; padding: 24px; }
        .login-card { width: 100%; max-width: 360px; background: rgba(237,231,217,0.05); border: 1px solid rgba(237,231,217,0.12);
          border-radius: 14px; padding: 34px 30px; box-shadow: 0 20px 50px rgba(0,0,0,0.4); }
        .login-title { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 20px; letter-spacing: 3px; margin: 0 0 4px; }
        .login-title span { color: #C98A3E; }
        .login-sub { font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 1px; color: #A79E8C; margin-bottom: 26px; }
        .login-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
        .login-field label { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #8c8574; }
        .login-field input { font-family: 'Manrope', sans-serif; font-size: 14px; padding: 10px 12px; border-radius: 6px;
          border: 1px solid rgba(237,231,217,0.15); background: #1e1c18; color: #EDE7D9; }
        .login-field input:focus { outline: none; border-color: #C98A3E; }
        .login-btn { width: 100%; margin-top: 6px; background: #C98A3E; color: #1a1815; border: none; border-radius: 6px;
          padding: 11px; font-family: 'Manrope', sans-serif; font-weight: 800; font-size: 14px; cursor: pointer; }
        .login-btn:disabled { opacity: 0.6; cursor: default; }
        .login-error { color: #E0917F; font-size: 12.5px; margin-top: 14px; line-height: 1.4; }
      `}</style>
      <form className="login-card" onSubmit={submit}>
        <div className="login-title">HAENYEO <span>/ SCHEDULING</span></div>
        <div className="login-sub">MANAGER SIGN IN</div>
        <div className="login-field">
          <label>Email</label>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="login-field">
          <label>Password</label>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="login-btn" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  );
}
