// Utility to clean up corrupted localStorage data
// This prevents the app from getting stuck in loading state

export const cleanupCorruptedLocalStorage = () => {
    console.log('🧹 Running localStorage cleanup...');

    try {
        // NOTE: Supabase auth tokens (sb-*, supabase, auth-token) are NOT cleared here.
        // Clearing them would destroy the active session and cause logout on every F5/refresh.
        // Supabase handles its own token lifecycle (refresh, expiry, etc.).

        // List of localStorage keys used by the app
        const appKeys = [
            'siscont_invoices',
            'siscont_documents',
            'siscont_allocations',
            'siscont_clients',
            'siscont_services',
            'siscont_users',
            'siscont_exits'
        ];

        // Try to parse each key - if it fails, it's corrupted
        appKeys.forEach(key => {
            try {
                const value = localStorage.getItem(key);
                if (value) {
                    JSON.parse(value); // Test if it's valid JSON
                }
            } catch (e) {
                console.warn(`⚠️ Corrupted localStorage key detected: ${key}, removing...`);
                localStorage.removeItem(key);
            }
        });

        // Also check for very old data (schema version mismatch)
        const checkSchemaCompatibility = () => {
            try {
                const invoices = localStorage.getItem('siscont_invoices');
                if (invoices) {
                    const parsed = JSON.parse(invoices);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const firstInvoice = parsed[0];
                        // Check if it has the new required fields
                        if (firstInvoice && typeof firstInvoice.adjustmentAddition === 'undefined') {
                            console.warn('📦 Old schema detected in localStorage, clearing...');
                            appKeys.forEach(key => localStorage.removeItem(key));
                        }
                    }
                }
            } catch (e) {
                console.error('Error checking schema compatibility:', e);
            }
        };

        checkSchemaCompatibility();

        console.log('✅ localStorage cleanup complete');

    } catch (e) {
        console.error('❌ Error during localStorage cleanup:', e);
        // If cleanup itself fails, clear everything as a last resort
        try {
            console.warn('🚨 Emergency cleanup: clearing all app data');
            const allKeys = Object.keys(localStorage);
            allKeys.forEach(key => {
                if (key.startsWith('siscont_')) {
                    try {
                        localStorage.removeItem(key);
                    } catch (clearError) {
                        console.error(`Failed to clear ${key}:`, clearError);
                    }
                }
            });
        } catch (clearError) {
            console.error('Failed emergency cleanup:', clearError);
        }
    }
};
