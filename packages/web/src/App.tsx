import { Outlet } from 'react-router';

/** The frame every page sits in. Navigation and the sign-in gate will live here. */
export default function App() {
  return (
    <main>
      <Outlet />
    </main>
  );
}
