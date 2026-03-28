import { useInfiniteQuery, useMutation, useQueryClient } from "react-query";

import { getChatUrl } from "@/config";
import { WorkMoments, WorkMomentsResponse } from "@/types/moment";
import createAxiosInstance from "@/utils/request";

const request = createAxiosInstance(getChatUrl(), false);

// publish moments
export const usePublishMoments = (queryKey?: string) => {
  const queryClient = useQueryClient();

  return useMutation(
    (params: API.Moments.PublishMomentsParams) =>
      request.post("/office/work_moment/add", {
        ...params,
      }),
    { onSuccess: () => queryClient.invalidateQueries(queryKey ?? "SelfMoments") },
  );
};

export const fetchUserMoments = async (
  { pageParam = 1 },
  userID?: string,
): Promise<WorkMoments[]> => {
  const url = `/office/work_moment/find/${!userID ? "recv" : "send"}`;
  try {
    const { data } = await request.post<WorkMomentsResponse>(url, {
      userID,
      pagination: {
        pageNumber: pageParam,
        showNumber: 20,
      },
    });
    return data.workMoments;
  } catch (error) {
    return [];
  }
};
export const useUserMoments = (enabled: boolean, queryKey?: string) => {
  return useInfiniteQuery<WorkMoments[]>(
    queryKey ?? "SelfMoments",
    (context) => fetchUserMoments(context, queryKey),
    {
      getNextPageParam: (lastPage, pages) =>
        lastPage?.length < 20 ? undefined : pages.length + 1,
      enabled,
    },
  );
};

export const getMomentsByID = (workMomentID: string) =>
  request.post<{ workMoment: WorkMoments }>("/office/work_moment/get", {
    workMomentID,
  });

export const useDeleteMoments = (queryKey?: string) => {
  const queryClient = useQueryClient();
  return useMutation(
    (workMomentID: string) =>
      request.post("/office/work_moment/del", {
        workMomentID,
      }),
    {
      onSuccess: () => queryClient.invalidateQueries(queryKey ?? "SelfMoments"),
    },
  );
};

export const useCreateComment = () => {
  const queryClient = useQueryClient();
  return useMutation(
    (params: API.Moments.CreateCommentParams) =>
      request.post("/office/work_moment/comment/add", {
        ...params,
      }),
    // {
    //   onSuccess: (res: { data: { commentID: string; workMoment: WorkMoments } }) => {
    //     const newWorkMoment = res.data.workMoment;
    //     queryClient.setQueryData<InfiniteData<WorkMoments[]> | undefined>(
    //       "SelfMoments",
    //       (oldData) => {
    //         if (!oldData) return oldData;
    //         const newPages = oldData.pages.map((page) =>
    //           page.map((item) =>
    //             item.workMomentID === newWorkMoment.workMomentID ? newWorkMoment : item,
    //           ),
    //         );
    //         return {
    //           ...oldData,
    //           pages: newPages,
    //         };
    //       },
    //     );
    //   },
    // },
  );
};

// delete comment
export const useDeleteComment = () => {
  const queryClient = useQueryClient();
  return useMutation(
    (params: API.Moments.DeleteCommentParams) =>
      request.post("/office/work_moment/comment/del", {
        ...params,
      }),
    // {
    //   onSuccess: (_, { workMomentID, commentID }) => {
    //     queryClient.setQueryData<InfiniteData<WorkMoments[]> | undefined>(
    //       "SelfMoments",
    //       (oldData) => {
    //         console.log(oldData);
    //         if (!oldData) return oldData;
    //         const newData = oldData.pages.map((page) => {
    //           const newPage = page.map((item) => {
    //             if (item.workMomentID === workMomentID) {
    //               const newComments = (item.comments ?? []).filter(
    //                 (commentItem) => commentItem.commentID !== commentID,
    //               );
    //               return { ...item, comments: newComments };
    //             }
    //             return item;
    //           });
    //           return newPage;
    //         });

    //         return {
    //           ...oldData,
    //           pages: newData,
    //         };
    //       },
    //     );
    //   },
    // },
  );
};

// like
export const useLikeMoments = () => {
  const queryClient = useQueryClient();
  return useMutation(
    (params: { workMomentID: string; like: boolean }) =>
      request.post("/office/work_moment/like", {
        ...params,
      }),
    // {
    //   onSuccess: (res: { data: { workMoment: WorkMoments } }) => {
    //     console.log(res);
    //     const newWorkMoment = res.data.workMoment;
    //     queryClient.setQueryData<InfiniteData<WorkMoments[]> | undefined>(
    //       "SelfMoments",
    //       (oldData) => {
    //         if (!oldData) return oldData;
    //         const newPages = oldData.pages.map((page) =>
    //           page.map((item) =>
    //             item.workMomentID === newWorkMoment.workMomentID ? newWorkMoment : item,
    //           ),
    //         );
    //         return {
    //           ...oldData,
    //           pages: newPages,
    //         };
    //       },
    //     );
    //   },
    // },
  );
};

// Querying for no readings
export const getMomentsUnreadCount = () =>
  request.post("/office/work_moment/unread/count", {});

// Query message list
export const useLogs = () => {
  return useInfiniteQuery<{ data: WorkMomentsResponse }>(
    ["MomentsMessageList"],
    ({ pageParam = 1 }) =>
      request.post("/office/work_moment/logs", {
        pagination: {
          pageNumber: pageParam as number,
          showNumber: 20,
        },
      }),
    {
      getNextPageParam: (lastPage, pages) => {
        if ((lastPage.data.workMoments?.length ?? 0) < 20) return null;
        return pages.length + 1;
      },
    },
  );
};

// Query message list
export enum MomentsClearType {
  Count = 1,
  List = 2,
  All = 3,
}
export const useClearUnreadMoments = () => {
  return useMutation((type: MomentsClearType) =>
    request.post("/office/work_moment/unread/clear", {
      type,
    }),
  );
};
