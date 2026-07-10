import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";
import Login from "./components/Login.jsx";
import SchedulingHub from "./App.jsx";

// Gates the whole app behind a Supabase session. While the initial session is
// resolving we render nothing (brief flash avoidance); no session -> Login;
// signed in -> the hub, with the session handed down for the sign-out control.
export default function AuthGate() {
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
