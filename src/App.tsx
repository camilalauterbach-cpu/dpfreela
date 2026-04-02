import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Workers from "./pages/Workers";
import WorkerForm from "./pages/WorkerForm";
import WorkerDetail from "./pages/WorkerDetail";
import Events from "./pages/Events";
import EventForm from "./pages/EventForm";
import EventDetail from "./pages/EventDetail";
import Companies from "./pages/Companies";
import CompanyForm from "./pages/CompanyForm";
import CompanyDetail from "./pages/CompanyDetail";
import Links from "./pages/Links";
import LinkDetail from "./pages/LinkDetail";
import LinkForm from "./pages/LinkForm";
import Payroll from "./pages/Payroll";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Protected routes with layout */}
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/workers" element={<Workers />} />
              <Route path="/workers/new" element={<WorkerForm />} />
              <Route path="/workers/:id" element={<WorkerDetail />} />
              <Route path="/workers/:id/edit" element={<WorkerForm />} />
              <Route path="/events" element={<Events />} />
              <Route path="/events/new" element={<EventForm />} />
              <Route path="/events/:id" element={<EventDetail />} />
              <Route path="/events/:id/edit" element={<EventForm />} />
              <Route path="/companies" element={<Companies />} />
              <Route path="/companies/new" element={<CompanyForm />} />
              <Route path="/companies/:id" element={<CompanyDetail />} />
              <Route path="/companies/:id/edit" element={<CompanyForm />} />
              <Route path="/links" element={<Links />} />
              <Route path="/links/new" element={<LinkForm />} />
              <Route path="/links/:id" element={<LinkDetail />} />
              <Route path="/links/:id/edit" element={<LinkForm />} />
              <Route path="/payroll" element={<Payroll />} />
              <Route path="/settings" element={<ProtectedRoute requiredRoles={["admin", "manager"]}><SettingsPage /></ProtectedRoute>} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
