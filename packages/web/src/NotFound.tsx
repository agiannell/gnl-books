import { Link } from 'react-router';

/** For an address no page answers to, and for a profile that is not in this family. */
export default function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to who’s reading</Link>
      </p>
    </>
  );
}
