import { Button, Form, Input, message } from "antd";
import { t } from "i18next";
import md5 from "md5";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useLogin } from "@/api/login";
import {
  getPhoneNumber,
  setAreaCode,
  setIMProfile,
  setPhoneNumber,
} from "@/utils/storage";
import type { FormType } from "./index";

// 0login 1resetPassword 2register
enum LoginType {
  Password,
  VerifyCode,
}

type LoginFormProps = {
  setFormType: (type: FormType) => void;
  loginMethod: "phone" | "email";
  updateLoginMethod: (method: "phone" | "email") => void;
};

const LoginForm = ({ loginMethod, setFormType, updateLoginMethod }: LoginFormProps) => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loginType, setLoginType] = useState<LoginType>(LoginType.Password);
  const { mutate: login, isLoading: loginLoading } = useLogin();

  // const [countdown, setCountdown] = useState(0);
  // useEffect(() => {
  //   if (countdown > 0) {
  //     const timer = setTimeout(() => {
  //       setCountdown((prevCountdown) => prevCountdown - 1);
  //       if (countdown === 1) {
  //         clearTimeout(timer);
  //         setCountdown(0);
  //       }
  //     }, 1000);
  //
  //     return () => clearTimeout(timer);
  //   }
  // }, [countdown]);

  const onFinish = (params: API.Login.LoginParams) => {
    console.log("🚀 [LoginForm] 开始登录流程", {
      loginType,
      params: { ...params, password: params.password ? "***" : undefined },
      timestamp: new Date().toISOString()
    });

    if (loginType === 0) {
      params.password = md5(params.password ?? "");
      console.log("🔐 [LoginForm] 密码已加密");
    }

    setAreaCode(params.areaCode);
    if (params.phoneNumber) {
      setPhoneNumber(params.phoneNumber);
      console.log("📱 [LoginForm] 保存手机号到本地存储");
    }
    // if (params.email) {
    //   setEmail(params.email);
    //   console.log("📧 [LoginForm] 保存邮箱到本地存储");
    // }

    console.log("🌐 [LoginForm] 发起登录API请求");
    login(params, {
      onSuccess: (data) => {
        console.log("✅ [LoginForm] 登录API成功", {
          hasData: !!data,
          hasDataData: !!data?.data,
          userID: data?.data?.userID,
          hasChatToken: !!data?.data?.chatToken,
          hasImToken: !!data?.data?.imToken,
          timestamp: new Date().toISOString()
        });

        const { chatToken, imToken, userID } = data.data;
        console.log("💾 [LoginForm] 开始保存用户信息到本地存储", {
          userID,
          hasChatToken: !!chatToken,
          hasImToken: !!imToken
        });

        setIMProfile({ chatToken, imToken, userID });
        console.log("🔄 [LoginForm] 用户信息已保存，准备跳转到聊天页面");
        navigate("/chat");
        console.log("🎯 [LoginForm] 已调用navigate('/chat')");
      },
      onError: (error) => {
        console.error("❌ [LoginForm] 登录失败", {
          error,
          timestamp: new Date().toISOString()
        });
      }
    });
  };

  // const sendSmsHandle = () => {
  //   semdSms(
  //     {
  //       phoneNumber: form.getFieldValue("phoneNumber") as string,
  //       email: form.getFieldValue("email") as string,
  //       areaCode: form.getFieldValue("areaCode") as string,
  //       usedFor: 3,
  //     },
  //     {
  //       onSuccess() {
  //         setCountdown(60);
  //       },
  //     },
  //   );
  // };

  // const Point = () => (
  //   <div
  //     className="relative h-16 w-16 cursor-pointer rounded-md"
  //     style={{
  //       background: "linear-gradient(to bottom left, #DBEAFE 50%, white 50%)",
  //     }}
  //     onClick={() => setLoginType(loginType === 2 ? 0 : 2)}
  //   >
  //     <img
  //       src={loginType === 2 ? login_pc : login_qr}
  //       alt="login"
  //       className=" absolute left-[25px] top-[15px]"
  //     />
  //   </div>
  // );

  // if (loginType === 2) {
  //   return (
  //     <>
  //       <div className="flex flex-row items-end justify-end">
  //         <Point />
  //       </div>

  //       <div className=" flex flex-col items-center">
  //         <div className="text-xl font-medium">{t("placeholder.qrCodeLogin")}</div>
  //         <span className=" mt-3 text-sm  text-gray-400">
  //           {t("placeholder.qrCodeLoginTitle")}
  //         </span>
  //         <QRCode className="mt-8" value="https://www.openim.online/zh" size={190} />
  //       </div>
  //     </>
  //   );
  // }

  // const onLoginMethodChange = (key: string) => {
  //   // 拦截邮箱登录切换
  //   if (key === "email") {
  //     message.warning(t("toast.featureNotAvailable"));
  //     return;
  //   }
  //   // 原先的代码
  //   updateLoginMethod(key as "phone" | "email");
  // };

  return (
    <>
      <div className="flex flex-row items-center justify-between">
        <div className="text-xl font-medium">{t("placeholder.welcome")}</div>
        {/* <Point /> */}
      </div>
      {/* 登录方式切换标签已隐藏，默认使用手机号登录 */}
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        autoComplete="off"
        labelCol={{ prefixCls: "custom-form-item" }}
        initialValues={{
          areaCode: "+86",
          phoneNumber: getPhoneNumber() ?? "",
          // email: getEmail() ?? "",
        }}
      >
        {/* 默认手机号登录：去掉区号选择，仅保留普通输入框 */}
        <Form.Item name="areaCode" initialValue={"+86"} hidden>
          <Input />
        </Form.Item>
        <Form.Item
          label={"账号"}
          name="phoneNumber"
          rules={[
            { required: true, message: "请输入账号" },
            { pattern: /^\d{11}$/, message: "请输入11位手机号" },
          ]}
        >
          <Input allowClear placeholder={"请输入11位手机号"} maxLength={11} />
        </Form.Item>

        {/* 验证码登录已隐藏，默认使用密码登录 */}
        <Form.Item label={t("placeholder.password")} name="password">
          <Input.Password allowClear placeholder={t("toast.inputPassword")} />
        </Form.Item>

        {/*
        <div className="mb-10 flex flex-row justify-between">
          <span className="cursor-pointer text-sm text-gray-400" onClick={() => setFormType(1)}>
            {t("placeholder.forgetPassword")}
          </span>
          <span className="cursor-pointer text-sm text-[var(--primary)]">
            {`${t("placeholder.verifyCode")}${t("placeholder.login")}`}
          </span>
        </div>
        */}

        <Form.Item className="mb-4">
          <Button type="primary" htmlType="submit" block loading={loginLoading}>
            {t("placeholder.login")}
          </Button>
        </Form.Item>

        <div className="flex flex-row items-center justify-center">
          <span className="text-sm text-gray-400">
            {t("placeholder.registerToast")}
          </span>
          <span
            className="cursor-pointer text-sm text-blue-500"
            onClick={() => setFormType(2)}
          >
            {t("placeholder.toRegister")}
          </span>
        </div>
      </Form>
    </>
  );
};

export default LoginForm;
