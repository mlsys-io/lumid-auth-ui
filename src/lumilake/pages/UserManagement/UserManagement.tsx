import React, { useEffect, useState } from "react";
import { MoreVertical, X } from "lucide-react";
import Icon from "../../components/ui/Icon";
import { UserManagementService } from "@/lumilake/services/usermanagementService";
import { UserInfo } from "@/lumilake/types/usermanagement";

type FormDataType = {
  external_id: string;
  email: string;
  phone_number: string;
  org_id: string;
  password: string;
  confirmPassword: string;
};

type FormErrors = {
  external_id?: string;
  email?: string;
  phone_number?: string;
  org_id?: string;
  password?: string;
  confirmPassword?: string;
};

type PasswordFormData = {
  oldPassword: string;
  password: string;
  confirmPassword: string;
};

type PasswordFormErrors = {
  oldPassword?: string;
  password?: string;
  confirmPassword?: string;
};


export const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [openAction, setOpenAction] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [selectedPrincipalId, setSelectedPrincipalId] = useState<string | null>(
    null
  );
  const [selectedUsername, setSelectedUsername] = useState<string>("");

  const [filterOrg, setFilterOrg] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const [showSuccessNotification, setShowSuccessNotification] = useState(false);
  const [showPasswordSuccessNotification, setShowPasswordSuccessNotification] =
    useState(false);
  const [showApiKeySuccessNotification, setShowApiKeySuccessNotification] =
    useState(false);

  const [passwordSuccessMessage, setPasswordSuccessMessage] = useState("");
  const [apiKeySuccessMessage, setApiKeySuccessMessage] = useState("");

  const [formData, setFormData] = useState<FormDataType>({
    external_id: "",
    email: "",
    phone_number: "",
    org_id: "",
    password: "",
    confirmPassword: "",
  });

  const [passwordFormData, setPasswordFormData] = useState<PasswordFormData>({
    oldPassword: "",
    password: "",
    confirmPassword: "",
  });

  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [passwordFormErrors, setPasswordFormErrors] =
    useState<PasswordFormErrors>({});

  const [submitError, setSubmitError] = useState("");
  const [passwordSubmitError, setPasswordSubmitError] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasswordSubmitting, setIsPasswordSubmitting] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await UserManagementService.getUsers();
      setUsers(data);
    } catch (error) {
      console.error("Failed to fetch users", error);
    }
  };

  const validateForm = () => {
    const errors: FormErrors = {};

    if (!formData.external_id.trim()) {
      errors.external_id = "Username is required";
    }

    if (!formData.email.trim()) {
      errors.email = "Email is required";
    }

    if (!formData.phone_number.trim()) {
      errors.phone_number = "Phone number is required";
    }

    if (!formData.org_id.trim()) {
      errors.org_id = "Organization is required";
    }

    if (!formData.password.trim()) {
      errors.password = "Password is required";
    }

    if (!formData.confirmPassword.trim()) {
      errors.confirmPassword = "Confirm password is required";
    }

    if (
      formData.password.trim() &&
      formData.confirmPassword.trim() &&
      formData.password !== formData.confirmPassword
    ) {
      errors.confirmPassword = "Passwords do not match";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validatePasswordForm = () => {
    const errors: PasswordFormErrors = {};

    if (!passwordFormData.oldPassword.trim()) {
      errors.oldPassword = "Old password is required";
    }

    if (!passwordFormData.password.trim()) {
      errors.password = "New password is required";
    }

    if (!passwordFormData.confirmPassword.trim()) {
      errors.confirmPassword = "Confirm password is required";
    }

    if (
      passwordFormData.password.trim() &&
      passwordFormData.confirmPassword.trim() &&
      passwordFormData.password !== passwordFormData.confirmPassword
    ) {
      errors.confirmPassword = "Passwords do not match";
    }

    if (
      passwordFormData.oldPassword.trim() &&
      passwordFormData.password.trim() &&
      passwordFormData.oldPassword === passwordFormData.password
    ) {
      errors.password = "New password must be different from the old password";
    }

    setPasswordFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFieldChange = (field: keyof FormDataType, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    setFormErrors((prev) => ({
      ...prev,
      [field]: "",
    }));

    setSubmitError("");
  };

  const handlePasswordFieldChange = (
    field: keyof PasswordFormData,
    value: string
  ) => {
    setPasswordFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    setPasswordFormErrors((prev) => ({
      ...prev,
      [field]: "",
    }));

    setPasswordSubmitError("");
  };

  const resetForm = () => {
    setFormData({
      external_id: "",
      email: "",
      phone_number: "",
      org_id: "",
      password: "",
      confirmPassword: "",
    });
    setFormErrors({});
    setSubmitError("");
  };

  const resetPasswordForm = () => {
    setPasswordFormData({
      oldPassword: "",
      password: "",
      confirmPassword: "",
    });
    setPasswordFormErrors({});
    setPasswordSubmitError("");
    setSelectedPrincipalId(null);
    setSelectedUsername("");
  };

  const handleAddUser = async () => {
    if (!validateForm()) return;

    try {
      setIsSubmitting(true);
      setSubmitError("");

      const createdUser = await UserManagementService.createUser({
        external_id: formData.external_id.trim(),
        email: formData.email.trim(),
        phone_number: formData.phone_number.trim(),
        org_id: formData.org_id.trim(),
      });

      if (!createdUser?.id) {
        throw new Error("User created but no principal ID was returned.");
      }

      await UserManagementService.createPassword(
        createdUser.id,
        formData.password.trim()
      );

      setIsModalOpen(false);
      resetForm();
      await loadUsers();

      setShowSuccessNotification(true);

      setTimeout(() => {
        setShowSuccessNotification(false);
      }, 5000);
    } catch (error) {
      console.error("Failed to create user", error);
      setSubmitError(
        "Failed to create user and password. Please check the input and try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateApiKey = async (principalId: string) => {
  try {
    await UserManagementService.createApiKey(principalId, "user");

    setApiKeySuccessMessage("The API key has been successfully created.");
    setShowApiKeySuccessNotification(true);

    setTimeout(() => {
      setShowApiKeySuccessNotification(false);
    }, 5000);

    setOpenAction(null);
  } catch (error) {
    console.error("Failed to create API key", error);
  }
};

  const openPasswordModal = (principalId: string, username: string) => {
    setSelectedPrincipalId(principalId);
    setSelectedUsername(username);
    setIsPasswordModalOpen(true);
    setOpenAction(null);
    setPasswordSubmitError("");
    setPasswordFormErrors({});
    setPasswordFormData({
      oldPassword: "",
      password: "",
      confirmPassword: "",
    });
  };

  const handlePasswordAction = async () => {
    if (!selectedPrincipalId) {
      setPasswordSubmitError("No user selected.");
      return;
    }

    if (!validatePasswordForm()) return;

    try {
      setIsPasswordSubmitting(true);
      setPasswordSubmitError("");

      const verifyResponse = await UserManagementService.verifyPassword(
        selectedPrincipalId,
        passwordFormData.oldPassword.trim()
      );

      if (!verifyResponse?.valid) {
        setPasswordSubmitError("Old password is incorrect.");
        return;
      }

      await UserManagementService.resetPassword(
        selectedPrincipalId,
        passwordFormData.password.trim()
      );
      setPasswordSuccessMessage("The password has been successfully reset.");

      setIsPasswordModalOpen(false);
      resetPasswordForm();

      setShowPasswordSuccessNotification(true);

      setTimeout(() => {
        setShowPasswordSuccessNotification(false);
      }, 5000);
    } catch (error) {
      console.error("Failed to reset password", error);
      setPasswordSubmitError(
        "Failed to reset password. Please check the input and try again."
      );
    } finally {
      setIsPasswordSubmitting(false);
    }
  };

  const organizations = Array.from(new Set(users.map((u) => u.org_id))).filter(
    Boolean
  );

  const filteredUsers = users.filter((user) => {
    const matchesOrg = filterOrg === "All" || user.org_id === filterOrg;

    const matchesSearch =
      user.external_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.phone_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.org_id?.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesOrg && matchesSearch;
  });

  return (
    <div className="p-6 min-h-full">
      {showSuccessNotification && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-4">
          <div className="mt-0.5">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
              <span className="text-xs font-bold text-green-600">✓</span>
            </div>
          </div>
          <div>
            <p className="text-xl font-semibold text-black">New User Added</p>
            <p className="text-sm text-black">
              The new user have been successfully created.
            </p>
          </div>
        </div>
      )}

      {showPasswordSuccessNotification && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-4">
          <div className="mt-0.5">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
              <span className="text-xs font-bold text-green-600">✓</span>
            </div>
          </div>
          <div>
            <p className="text-xl font-semibold text-black">Password Reset</p>
            <p className="text-sm text-black">{passwordSuccessMessage}</p>
          </div>
        </div>
      )}

      {showApiKeySuccessNotification && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-4">
          <div className="mt-0.5">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
              <span className="text-xs font-bold text-green-600">✓</span>
            </div>
          </div>
          <div>
            <p className="text-xl font-semibold text-black">API Key Created</p>
            <p className="text-sm text-black">{apiKeySuccessMessage}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow border p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-blue">
            User Management
          </h1>

          <div className="flex items-center gap-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm pr-8 w-64"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                <Icon name="search" className="h-4 w-4 text-gray-400" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Filter by:</span>
              <select
                value={filterOrg}
                onChange={(e) => setFilterOrg(e.target.value)}
                className="border rounded-md px-3 py-1.5 text-sm"
              >
                <option value="All">All</option>
                {organizations.map((org) => (
                  <option key={org} value={org}>
                    {org}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 rounded-md font-semibold border mb-6 bg-white border-blue text-blue hover:bg-blue hover:text-white"
        >
          + Add User
        </button>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left text-gray-600">
                <th className="p-3">Username</th>
                <th className="p-3">Email</th>
                <th className="p-3">Phone Number</th>
                <th className="p-3">Organization</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>

            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium text-gray-700">
                    {user.external_id}
                  </td>
                  <td className="p-3 text-gray-500">{user.email}</td>
                  <td className="p-3 text-gray-500">{user.phone_number}</td>
                  <td className="p-3 text-gray-700">{user.org_id}</td>

                  <td className="p-3 text-center relative">
                    <button
                      onClick={() =>
                        setOpenAction(openAction === user.id ? null : user.id)
                      }
                      className="p-2 hover:bg-gray-100 rounded"
                    >
                      <MoreVertical size={18} />
                    </button>

                    {openAction === user.id && (
                      <div className="absolute right-10 mt-2 w-44 bg-white border rounded-md shadow-lg z-10">
                        <button
                          onClick={() => handleCreateApiKey(user.id)}
                          className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                        >
                          Create API Key
                        </button>

                        <button
                          onClick={() =>
                            openPasswordModal(user.id, user.external_id)
                          }
                          className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                        >
                          Reset Password
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}

              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-gray-500">
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
          <div className="bg-white rounded-xl w-[420px] p-6 relative">
            <button
              onClick={() => {
                setIsModalOpen(false);
                resetForm();
              }}
              className="absolute top-4 right-4"
            >
              <X size={18} />
            </button>

            <h2 className="text-3xl font-bold mb-4 text-blue">Add User</h2>

            <div className="space-y-4">
              <div>
                <h1 className="text-lg font-bold text-blue mb-1">Username</h1>
                <input
                  placeholder="Username"
                  value={formData.external_id}
                  onChange={(e) =>
                    handleFieldChange("external_id", e.target.value)
                  }
                  className={`w-full border px-3 py-2 rounded-md ${
                    formErrors.external_id ? "border-red-500" : "border-gray-300"
                  }`}
                />
                {formErrors.external_id && (
                  <p className="text-red-500 text-sm mt-1">
                    {formErrors.external_id}
                  </p>
                )}
              </div>

              <div>
                <h1 className="text-lg font-bold text-blue mb-1">Email</h1>
                <input
                  placeholder="Email"
                  value={formData.email}
                  onChange={(e) => handleFieldChange("email", e.target.value)}
                  className={`w-full border px-3 py-2 rounded-md ${
                    formErrors.email ? "border-red-500" : "border-gray-300"
                  }`}
                />
                {formErrors.email && (
                  <p className="text-red-500 text-sm mt-1">{formErrors.email}</p>
                )}
              </div>

              <div>
                <h1 className="text-lg font-bold text-blue mb-1">
                  Phone Number
                </h1>
                <input
                  placeholder="Phone"
                  value={formData.phone_number}
                  onChange={(e) =>
                    handleFieldChange("phone_number", e.target.value)
                  }
                  className={`w-full border px-3 py-2 rounded-md ${
                    formErrors.phone_number
                      ? "border-red-500"
                      : "border-gray-300"
                  }`}
                />
                {formErrors.phone_number && (
                  <p className="text-red-500 text-sm mt-1">
                    {formErrors.phone_number}
                  </p>
                )}
              </div>

              <div>
                <h1 className="text-lg font-bold text-blue mb-1">
                  Organization
                </h1>
                <input
                  placeholder="Organization"
                  value={formData.org_id}
                  onChange={(e) => handleFieldChange("org_id", e.target.value)}
                  className={`w-full border px-3 py-2 rounded-md ${
                    formErrors.org_id ? "border-red-500" : "border-gray-300"
                  }`}
                />
                {formErrors.org_id && (
                  <p className="text-red-500 text-sm mt-1">{formErrors.org_id}</p>
                )}
              </div>

              <div>
                <h1 className="text-lg font-bold text-blue mb-1">Password</h1>
                <input
                  type="password"
                  placeholder="Enter password"
                  value={formData.password}
                  onChange={(e) =>
                    handleFieldChange("password", e.target.value)
                  }
                  className={`w-full border px-3 py-2 rounded-md ${
                    formErrors.password ? "border-red-500" : "border-gray-300"
                  }`}
                />
                {formErrors.password && (
                  <p className="text-red-500 text-sm mt-1">
                    {formErrors.password}
                  </p>
                )}
              </div>

              <div>
                <h1 className="text-lg font-bold text-blue mb-1">
                  Confirm Password
                </h1>
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={formData.confirmPassword}
                  onChange={(e) =>
                    handleFieldChange("confirmPassword", e.target.value)
                  }
                  className={`w-full border px-3 py-2 rounded-md ${
                    formErrors.confirmPassword
                      ? "border-red-500"
                      : "border-gray-300"
                  }`}
                />
                {formErrors.confirmPassword && (
                  <p className="text-red-500 text-sm mt-1">
                    {formErrors.confirmPassword}
                  </p>
                )}
              </div>

              {submitError && (
                <p className="text-red-500 text-sm">{submitError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  resetForm();
                }}
                className="border px-4 py-2 rounded-md"
              >
                Cancel
              </button>

              <button
                onClick={handleAddUser}
                disabled={isSubmitting}
                className="bg-[#344293] text-white px-4 py-2 rounded-md disabled:opacity-50"
              >
                {isSubmitting ? "Adding..." : "Add User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isPasswordModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
          <div className="bg-white rounded-xl w-[420px] p-6 relative">
            <button
              onClick={() => {
                setIsPasswordModalOpen(false);
                resetPasswordForm();
              }}
              className="absolute top-4 right-4"
            >
              <X size={18} />
            </button>

            <h2 className="text-3xl font-bold mb-2 text-blue">
              Reset Password
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {selectedUsername
                ? `Reset password for ${selectedUsername}`
                : "Reset a password"}
            </p>

            <div className="space-y-4">
              <div>
                <h1 className="text-lg font-bold text-blue mb-1">
                  Current Password
                </h1>
                <input
                  type="password"
                  placeholder="Enter old password"
                  value={passwordFormData.oldPassword}
                  onChange={(e) =>
                    handlePasswordFieldChange("oldPassword", e.target.value)
                  }
                  className={`w-full border px-3 py-2 rounded-md ${
                    passwordFormErrors.oldPassword
                      ? "border-red-500"
                      : "border-gray-300"
                  }`}
                />
                {passwordFormErrors.oldPassword && (
                  <p className="text-red-500 text-sm mt-1">
                    {passwordFormErrors.oldPassword}
                  </p>
                )}
              </div>

              <div>
                <h1 className="text-lg font-bold text-blue mb-1">
                  New Password
                </h1>
                <input
                  type="password"
                  placeholder="Enter new password"
                  value={passwordFormData.password}
                  onChange={(e) =>
                    handlePasswordFieldChange("password", e.target.value)
                  }
                  className={`w-full border px-3 py-2 rounded-md ${
                    passwordFormErrors.password
                      ? "border-red-500"
                      : "border-gray-300"
                  }`}
                />
                {passwordFormErrors.password && (
                  <p className="text-red-500 text-sm mt-1">
                    {passwordFormErrors.password}
                  </p>
                )}
              </div>

              <div>
                <h1 className="text-lg font-bold text-blue mb-1">
                  Confirm Password
                </h1>
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={passwordFormData.confirmPassword}
                  onChange={(e) =>
                    handlePasswordFieldChange("confirmPassword", e.target.value)
                  }
                  className={`w-full border px-3 py-2 rounded-md ${
                    passwordFormErrors.confirmPassword
                      ? "border-red-500"
                      : "border-gray-300"
                  }`}
                />
                {passwordFormErrors.confirmPassword && (
                  <p className="text-red-500 text-sm mt-1">
                    {passwordFormErrors.confirmPassword}
                  </p>
                )}
              </div>

              {passwordSubmitError && (
                <p className="text-red-500 text-sm">{passwordSubmitError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setIsPasswordModalOpen(false);
                  resetPasswordForm();
                }}
                className="border px-4 py-2 rounded-md"
              >
                Cancel
              </button>

              <button
                onClick={handlePasswordAction}
                disabled={isPasswordSubmitting}
                className="bg-blue text-white px-4 py-2 rounded-md disabled:opacity-50"
              >
                {isPasswordSubmitting ? "Resetting..." : "Reset Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};