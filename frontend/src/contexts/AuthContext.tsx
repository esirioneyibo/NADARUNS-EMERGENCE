import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "nadaruns_auth_token";
const USER_KEY = "nadaruns_user";

interface User {
  id: string;
  name: string;
  email?: string;
  type: "driver" | "admin";
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string, user: User) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Storage helpers - use SecureStore on native, AsyncStorage on web
async function setItem(key: string, value: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem(key);
  } else {
    return SecureStore.getItemAsync(key);
  }
}

async function deleteItem(key: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load saved auth state on mount
  useEffect(() => {
    (async () => {
      try {
        const savedToken = await getItem(TOKEN_KEY);
        const savedUser = await getItem(USER_KEY);
        
        if (savedToken && savedUser) {
          setToken(savedToken);
          setUser(JSON.parse(savedUser));
        }
      } catch (e) {
        console.warn("Failed to load auth state:", e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = async (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    
    try {
      await setItem(TOKEN_KEY, newToken);
      await setItem(USER_KEY, JSON.stringify(newUser));
    } catch (e) {
      console.warn("Failed to save auth state:", e);
    }
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    
    try {
      await deleteItem(TOKEN_KEY);
      await deleteItem(USER_KEY);
    } catch (e) {
      console.warn("Failed to clear auth state:", e);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!token,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
