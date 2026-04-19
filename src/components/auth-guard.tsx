import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import React from 'react';
import { Loading } from './ui/loading';

interface AuthGuardProps {
	children: React.ReactNode;
	requireAuth?: boolean;
}

export function AuthGuard({ children, requireAuth = true }: AuthGuardProps) {
	const { isLoading, isAuthenticated } = useAuth();

	if (isLoading) {
		return <Loading fullScreen />;
	}

	// If authentication is required and user is not authenticated, redirect to login
	if (requireAuth && !isAuthenticated) {
		return <Navigate to="/login" replace />;
	}

	// If authentication is NOT required (login page) and user IS authenticated, redirect to app
	if (!requireAuth && isAuthenticated) {
		return <Navigate to="/strategy" replace />;
	}

	return <>{children}</>;
}
