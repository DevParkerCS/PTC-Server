import { supabase } from "../supabaseClient";
import type { Request, Response, NextFunction } from "express";

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.split(" ")[1];

  const { data, error } = await supabase.auth.getUser(token);
  // This call validates the JWT with Supabase and returns the user if it’s legit. :contentReference[oaicite:0]{index=0}

  if (error || !data.user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Attach user to the request so your routes can use it
  (req as any).user = data.user; // e.g. user.id, user.email, etc.

  next();
};
