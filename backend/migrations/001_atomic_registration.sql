-- Apply in Supabase SQL Editor. The lock serializes registrations per event,
-- so duplicate requests and capacity checks remain correct under concurrency.
create or replace function public.register_for_event(p_user_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text;
    v_event public.events%rowtype;
    v_row public.registration%rowtype;
    v_count integer;
begin
    select role into v_role from public.users where id = p_user_id;
    if not found then
        raise exception 'User not found.' using errcode = 'P0001';
    end if;
    if lower(coalesce(v_role, '')) <> 'student' then
        raise exception 'Only student users can register.' using errcode = 'P0001';
    end if;

    select * into v_event from public.events where id = p_event_id for update;
    if not found then
        raise exception 'Event not found.' using errcode = 'P0001';
    end if;
    if lower(coalesce(v_event.status, 'open')) not in ('open', 'upcoming') then
        raise exception 'This event is closed.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.registration where event_id = p_event_id and user_id = p_user_id) then
        raise exception 'You are already registered for this event.' using errcode = 'P0001';
    end if;

    select count(*) into v_count from public.registration where event_id = p_event_id;
    if v_count >= v_event.capacity then
        raise exception 'This event is full.' using errcode = 'P0001';
    end if;

    insert into public.registration (user_id, event_id)
    values (p_user_id, p_event_id)
    returning * into v_row;
    return jsonb_build_object('registration', to_jsonb(v_row));
end;
$$;

grant execute on function public.register_for_event(uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
