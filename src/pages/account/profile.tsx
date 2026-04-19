import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, User as UserIcon, Lock, Camera, Save, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { ApiError } from '../../api';
import { updateProfile, changePassword } from '../../api/profile';

// /account/profile — self-service profile editing + password change.
// Two side-by-side cards: profile (name + avatar) and password
// (old -> new). Avatar is read as a base64 data URL and POSTed
// inline; we can swap to multipart + MinIO once that's wired.

export default function Profile() {
	const navigate = useNavigate();
	const { user, logout } = useAuth();

	const [editing, setEditing] = useState(false);
	const [username, setUsername] = useState(user?.username ?? '');
	const [avatar, setAvatar] = useState<string>(user?.avatar ?? '');
	const [savingProfile, setSavingProfile] = useState(false);
	const avatarInputRef = useRef<HTMLInputElement>(null);

	const [oldPwd, setOldPwd] = useState('');
	const [newPwd, setNewPwd] = useState('');
	const [confirmPwd, setConfirmPwd] = useState('');
	const [savingPwd, setSavingPwd] = useState(false);

	if (!user) return null;
	const initial = (user.username || user.email).slice(0, 1).toUpperCase();

	async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
		const f = e.target.files?.[0];
		if (!f) return;
		if (f.size > 3 * 1024 * 1024) {
			toast.error('Avatar must be under 3MB');
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			setAvatar(typeof reader.result === 'string' ? reader.result : '');
		};
		reader.readAsDataURL(f);
	}

	async function saveProfile() {
		setSavingProfile(true);
		try {
			await updateProfile({
				username: username.trim() || undefined,
				avatar: avatar || undefined,
			});
			toast.success('Profile updated');
			setEditing(false);
			window.location.reload();
		} catch (err) {
			const m = err instanceof ApiError ? err.message : 'Update failed';
			toast.error(m);
		} finally {
			setSavingProfile(false);
		}
	}

	async function submitPassword() {
		if (newPwd.length < 8) {
			toast.error('New password must be at least 8 characters');
			return;
		}
		if (newPwd !== confirmPwd) {
			toast.error('New password confirmation does not match');
			return;
		}
		if (oldPwd === newPwd) {
			toast.error('New password must differ from the old one');
			return;
		}
		setSavingPwd(true);
		try {
			await changePassword({ old_password: oldPwd, new_password: newPwd });
			toast.success('Password changed — other devices signed out');
			setOldPwd('');
			setNewPwd('');
			setConfirmPwd('');
		} catch (err) {
			const m = err instanceof ApiError ? err.message : 'Password change failed';
			toast.error(m);
		} finally {
			setSavingPwd(false);
		}
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
			<div className="max-w-3xl mx-auto px-4 py-10">
				<header className="flex items-center justify-between mb-8">
					<Button variant="ghost" size="sm" onClick={() => navigate('/account')}>
						<ArrowLeft className="w-4 h-4 mr-1" />
						Account
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={async () => {
							await logout();
							navigate('/login');
						}}
					>
						Sign out
					</Button>
				</header>

				<section className="grid gap-6 md:grid-cols-2">
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<UserIcon className="w-4 h-4 text-indigo-600" />
								Profile
							</CardTitle>
							<CardDescription>
								Your display name and avatar across every Lumid app.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex items-center gap-4">
								<Avatar className="w-16 h-16">
									<AvatarImage src={avatar || user.avatar || undefined} />
									<AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
										{initial}
									</AvatarFallback>
								</Avatar>
								{editing && (
									<div>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => avatarInputRef.current?.click()}
										>
											<Camera className="w-4 h-4 mr-2" />
											Upload
										</Button>
										<input
											ref={avatarInputRef}
											type="file"
											accept="image/png,image/jpeg,image/webp"
											hidden
											onChange={onPickAvatar}
										/>
									</div>
								)}
							</div>

							<div className="space-y-1">
								<Label>Email</Label>
								<Input value={user.email} disabled />
								<p className="text-xs text-muted-foreground">
									Email is your canonical identifier and cannot be changed here.
								</p>
							</div>

							<div className="space-y-1">
								<Label htmlFor="uname">Display name</Label>
								<Input
									id="uname"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									disabled={!editing || savingProfile}
								/>
							</div>

							<div className="flex gap-2 justify-end">
								{editing ? (
									<>
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												setEditing(false);
												setUsername(user.username ?? '');
												setAvatar(user.avatar ?? '');
											}}
											disabled={savingProfile}
										>
											<X className="w-4 h-4 mr-1" />
											Cancel
										</Button>
										<Button size="sm" onClick={saveProfile} disabled={savingProfile}>
											<Save className="w-4 h-4 mr-1" />
											{savingProfile ? 'Saving…' : 'Save'}
										</Button>
									</>
								) : (
									<Button variant="outline" size="sm" onClick={() => setEditing(true)}>
										Edit
									</Button>
								)}
							</div>
						</CardContent>
					</Card>

					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<Lock className="w-4 h-4 text-indigo-600" />
								Password
							</CardTitle>
							<CardDescription>
								Changing your password signs out every other device immediately.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1">
								<Label htmlFor="old-pw">Current password</Label>
								<Input
									id="old-pw"
									type="password"
									value={oldPwd}
									onChange={(e) => setOldPwd(e.target.value)}
									disabled={savingPwd}
									autoComplete="current-password"
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="new-pw">New password</Label>
								<Input
									id="new-pw"
									type="password"
									value={newPwd}
									onChange={(e) => setNewPwd(e.target.value)}
									disabled={savingPwd}
									autoComplete="new-password"
								/>
								<p className="text-xs text-muted-foreground">At least 8 characters.</p>
							</div>
							<div className="space-y-1">
								<Label htmlFor="confirm-pw">Confirm new password</Label>
								<Input
									id="confirm-pw"
									type="password"
									value={confirmPwd}
									onChange={(e) => setConfirmPwd(e.target.value)}
									disabled={savingPwd}
									autoComplete="new-password"
								/>
							</div>
							<div className="flex justify-end">
								<Button
									size="sm"
									onClick={submitPassword}
									disabled={savingPwd || !oldPwd || !newPwd || !confirmPwd}
								>
									{savingPwd ? 'Saving…' : 'Change password'}
								</Button>
							</div>
						</CardContent>
					</Card>
				</section>
			</div>
		</div>
	);
}
