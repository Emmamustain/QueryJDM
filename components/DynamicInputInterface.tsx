"use client";

import React, { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { QueryResult, VariableContents } from "@/utils/parseQuery";

type SearchResults = {
  result: QueryResult;
  variables: VariableContents;
};

export default function DynamicInputInterface() {
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [AST, setAST] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [optimize, setOptimize] = useState(false);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  const getColorClasses = () => {
    const baseClasses = isDarkMode ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-900";
    return `${baseClasses}`;
  };

  const handleSearch = async () => {
    setError("");
    if (!query) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/process-query?query=${encodeURIComponent(query)}&optimize=${optimize}`);
      const data = await response.json();
      setSearchResults(data);
      if (data.error) {
        setError(data.error);
      }
      if (data.ast) {
        setAST(data.ast);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center ${getColorClasses()} transition-colors duration-300 py-20`}>
      <div className="absolute inset-0 bg-grid-white/[0.05] -z-10" />
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-3xl relative">
        <div className="absolute top-4 right-4 flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Sun className="h-4 w-4 text-yellow-500" />
            <Switch checked={isDarkMode} onCheckedChange={toggleDarkMode} />
            <Moon className="h-4 w-4 text-blue-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-6 text-center dark:text-white">Interface JDM</h1>

        {error !== "" ? <div className="text-red-500">Error: {error}</div> : null}

        <div className="flex flex-col items-center gap-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full border-2 border-gray-300 dark:border-gray-600 px-4 py-2 rounded-lg focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 bg-transparent dark:text-white"
            placeholder="Enter your query"
          />

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="optimize"
              checked={optimize}
              onChange={(e) => setOptimize(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="optimize" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Optimiser la requête
            </label>
          </div>

          <Button onClick={handleSearch} disabled={isLoading}>
            {isLoading ? "Searching..." : "Rechercher"}
          </Button>
        </div>

        <div className="mt-6 p-4 bg-gray-200 dark:bg-gray-700 rounded">
          <h2 className="text-lg font-semibold mb-2 dark:text-white">Abstract Syntax Tree:</h2>
          <p className="break-words dark:text-gray-300">{AST}</p>
        </div>

        {/* Results Grid */}
        {searchResults && searchResults?.result.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold mb-4 dark:text-white">Result:</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg">
                <div className="max-h-48 overflow-y-auto">
                  <ul className="space-y-1">
                    {searchResults?.result.map((value, index) => (
                      <li key={index} className="text-sm dark:text-gray-300">
                        {value}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">Total values: {searchResults?.result?.length}</div>
              </div>
            </div>
          </div>
        )}

        {searchResults && searchResults?.variables.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold mb-4 dark:text-white">Variables:</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {searchResults.variables.map((variable) => (
                <div key={variable.name} className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold mb-2 dark:text-white">Variable: {variable.name}</h3>
                  <div className="max-h-48 overflow-y-auto">
                    <ul className="space-y-1">
                      {variable.value.map((value, index) => (
                        <li key={index} className="text-sm dark:text-gray-300">
                          {value}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">Total values: {variable.value.length}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
