import React, { useState, useEffect, useCallback } from 'react';
import StockManagerApp from './components/StockManagerApp';
import Auth from './components/Auth';
import { supabase } from './lib/supabaseClient';
import { BrandIcon } from './components/Icons';

const App = () => {
    const [session, setSession] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [profileError, setProfileError] = useState(null);

    const fetchUserProfile = useCallback(async (user) => {
        if (!user) {
            setUserProfile(null);
            return;
        }
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', user.id)
                .single();

            if (error) {
                // Throw the error to be caught by the catch block
                throw error;
            }
            
            setUserProfile(data);
            // Clear any previous errors on a successful fetch
            setProfileError(null); 
            
        } catch (e) {
            console.error("Error fetching user profile:", e.message);
            if (e.message && e.message.includes('infinite recursion')) {
                setProfileError("Database Configuration Error: A security policy on the 'users' table is causing an infinite loop. An administrator must fix the RLS policy.");
            } else {
                setProfileError(`Failed to load user profile: ${e.message}`);
            }
            setUserProfile(null);
        }
    }, []);

    useEffect(() => {
        setLoading(true);
        setProfileError(null);
    
        // Check the session on initial load. This is more reliable for the first render.
        supabase.auth.getSession().then(async ({ data: { session } }) => {
            if (session?.user) {
                await fetchUserProfile(session.user);
            } else {
                setUserProfile(null);
            }
            setSession(session);
            setLoading(false);
        }).catch(err => {
            console.error("Error fetching session on load:", err);
            setLoading(false);
            setProfileError("Could not verify your session. Please try logging in again.");
        });
    
        // Listen for subsequent auth state changes (e.g., login, logout).
        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            if (session?.user) {
                fetchUserProfile(session.user);
            } else {
                setUserProfile(null);
            }
        });
    
        return () => {
            authListener?.subscription?.unsubscribe();
        };
    }, [fetchUserProfile]);

    if (profileError) {
        return (
            <div className="flex flex-col justify-center items-center min-h-screen bg-red-50 text-red-800 p-4 text-center">
                 <BrandIcon className="w-16 h-16 text-red-500 mb-4" />
                <h1 className="text-2xl font-bold mb-2">Application Error</h1>
                <p className="max-w-md">{profileError}</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center min-h-screen bg-zinc-100 dark:bg-zinc-900">
                <BrandIcon className="w-16 h-16 text-blue-600 animate-pulse" />
                <p className="text-zinc-600 dark:text-zinc-400 mt-4">Loading Application...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900">
            {!session ? <Auth /> : <StockManagerApp key={session.user.id} userProfile={userProfile} />}
        </div>
    );
};

export default App;