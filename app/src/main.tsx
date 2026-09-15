import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import AddStudentPage from "./pages/AddStudentPage";
import BudgetAlertsPage from "./pages/BudgetAlertsPage";
import DashboardPage from "./pages/DashboardPage";
import MePage from "./pages/MePage";
import NotFoundPage from "./pages/NotFoundPage";
import StudentsPage from "./pages/StudentsPage";
import Providers from "./providers";
import { applyStoredColorMode } from "@/lib/theme";
import "./globals.css";

// Before the first render, not inside a component: Cloudscape's dark mode is a
// class on <body>, and a dark-mode user whose class arrived one paint late would
// see the app flash white. There is no prerendered HTML to disagree with here, so
// this is the only place the initial mode has to be set - ThemeProvider takes
// over for every change after it.
applyStoredColorMode();

const container = document.getElementById("root");
// Thrown rather than asserted: if index.html ever loses the element, an explicit
// message beats "Cannot read properties of null".
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    {/*
      Providers is inside the router because most of what it contains navigates:
      AuthProvider redirects to the stashed destination after sign-in, AudienceGate
      sends a student away from an admin route, and AppShell renders the nav.

      Route paths carry no trailing slash while the CDP suites request "/students/".
      react-router matches both, which is also why lib/nav.ts still normalizes a
      path before comparing it to an href.
    */}
    <BrowserRouter>
      <Providers>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/students" element={<StudentsPage />} />
          <Route path="/students/new" element={<AddStudentPage />} />
          <Route path="/me" element={<MePage />} />
          <Route path="/budget-alerts" element={<BudgetAlertsPage />} />
          {/*
            Reached in one of two ways: a link into a path this build does not
            have, or CloudFront serving index.html for a URL that matches no
            route. Both are the same thing to the user.
          */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Providers>
    </BrowserRouter>
  </StrictMode>,
);
