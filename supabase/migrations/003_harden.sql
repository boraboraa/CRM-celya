-- Les fonctions de trigger ne doivent pas être exposées via /rest/v1/rpc,
-- et search_path est figé sur toutes les fonctions du CRM.
revoke all on function public.handle_new_user()          from public, anon, authenticated;
revoke all on function public.guard_profile_privileges() from public, anon, authenticated;
revoke all on function public.bump_last_contact()        from public, anon, authenticated;
revoke all on function public.sync_next_action()         from public, anon, authenticated;
revoke all on function public.touch_updated_at()         from public, anon, authenticated;
revoke all on function public.stamp_task_completion()    from public, anon, authenticated;
