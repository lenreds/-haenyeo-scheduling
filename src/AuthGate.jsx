import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";
import Login from "./components/Login.jsx";
import SchedulingHub from "./App.jsx";

// Gates the whole app behind a Supabase session. While the initial session is
// resolving we render nothing (brief flash avoidance); no session -> Login;
// signed in -> the hub, with the session handed down for the sign-out control.
// Local-dev-only bypass: set VITE_AUTH_BYPASS=1 in .env.development.local
// (gitignored) to preview the hub without signing in. import.meta.env.DEV is
// false in production builds, so this can never activate on Vercel.
const DEV_BYPASS = import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === "1";

export default function AuthGate() {
  if (DEV_BYPASS) {
    return <SchedulingHub session={null} onSignOut={() => {}} />;
  }
  return <AuthedGate />;
}

function AuthedGate() {
  const [session, setSession] = useState(undefined); // undefined = still loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <Login />;

  return <SchedulingHub session={session} onSignOut={() => supabase.auth.signOut()} />;
}
