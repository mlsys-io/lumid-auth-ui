import { apiService } from "@/lumilake/services/api";
import { ApiKeyResponse, UserInfo } from "@/lumilake/types/usermanagement";

type VerifyPasswordResponse = {
  ok?: boolean;
  valid: boolean;
};

type PasswordResponse = {
  ok?: boolean;
  valid?: boolean;
  message?: string;
};

export class UserManagementService {
  static async getUsers(): Promise<UserInfo[]> {
    return apiService.get<UserInfo[]>("/principals");
  }

  static async getUser(id: string): Promise<UserInfo> {
    return apiService.get<UserInfo>(`/principals/${id}`);
  }

  static async createUser(data: {
    external_id: string;
    email: string;
    phone_number: string;
    org_id: string;
  }): Promise<UserInfo> {
    return apiService.post<UserInfo>("/principals/users", data);
  }

  static async createApiKey(
    principal_id: string,
    type: string,
    scopes: string[] = []
  ): Promise<ApiKeyResponse> {
    return apiService.post<ApiKeyResponse>("/auth/keys", {
      principal_id,
      key_type: type,
      scopes,
    });
  }

  static async createPassword(
    principal_id: string,
    password: string
  ): Promise<PasswordResponse> {
    return apiService.post<PasswordResponse>(
      `/principals/${principal_id}/password`,
      {
        password,
      }
    );
  }

  static async verifyPassword(
    principal_id: string,
    old_password: string
  ): Promise<VerifyPasswordResponse> {
    return apiService.post<VerifyPasswordResponse>(
      `/principals/${principal_id}/verify-password`,
      {
        password: old_password,
      }
    );
  }

  static async resetPassword(
    principal_id: string,
    new_password: string
  ): Promise<PasswordResponse> {
    return apiService.patch<PasswordResponse>(`/principals/${principal_id}`, {
      password: new_password,
    });
  }
}