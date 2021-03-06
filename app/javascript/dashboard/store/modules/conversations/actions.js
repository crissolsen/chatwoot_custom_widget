import Vue from 'vue';
import types from '../../mutation-types';
import ConversationApi from '../../../api/inbox/conversation';
import MessageApi from '../../../api/inbox/message';
import { MESSAGE_STATUS, MESSAGE_TYPE } from 'shared/constants/messages';
import { createPendingMessage } from 'dashboard/helper/commons';

const setPageFilter = ({ dispatch, filter, page, markEndReached }) => {
  dispatch('conversationPage/setCurrentPage', { filter, page }, { root: true });
  if (markEndReached) {
    dispatch('conversationPage/setEndReached', { filter }, { root: true });
  }
};

const setContacts = (commit, chatList) => {
  commit(
    `contacts/${types.SET_CONTACTS}`,
    chatList.map(chat => chat.meta.sender)
  );
};

const buildConversationList = (
  context,
  requestPayload,
  responseData,
  filterType
) => {
  const { payload: conversationList, meta: metaData } = responseData;
  context.commit(types.SET_ALL_CONVERSATION, conversationList);
  context.dispatch('conversationStats/set', metaData);
  context.dispatch(
    'conversationLabels/setBulkConversationLabels',
    conversationList
  );
  context.commit(types.CLEAR_LIST_LOADING_STATUS);
  setContacts(context.commit, conversationList);
  setPageFilter({
    dispatch: context.dispatch,
    filter: filterType,
    page: requestPayload.page,
    markEndReached: !conversationList.length,
  });
};
// actions
const actions = {
  getConversation: async ({ commit }, conversationId) => {
    try {
      const response = await ConversationApi.show(conversationId);
      commit(types.UPDATE_CONVERSATION, response.data);
      commit(`contacts/${types.SET_CONTACT_ITEM}`, response.data.meta.sender);
    } catch (error) {
      // Ignore error
    }
  },

  fetchAllConversations: async ({ commit, dispatch }, params) => {
    commit(types.SET_LIST_LOADING_STATUS);
    try {
      const {
        data: { data },
      } = await ConversationApi.get(params);
      buildConversationList(
        { commit, dispatch },
        params,
        data,
        params.assigneeType
      );
    } catch (error) {
      // Handle error
    }
  },

  fetchFilteredConversations: async ({ commit, dispatch }, params) => {
    commit(types.SET_LIST_LOADING_STATUS);
    try {
      const { data } = await ConversationApi.filter(params);
      buildConversationList(
        { commit, dispatch },
        params,
        data,
        'appliedFilters'
      );
    } catch (error) {
      // Handle error
    }
  },

  emptyAllConversations({ commit }) {
    commit(types.EMPTY_ALL_CONVERSATION);
  },

  clearSelectedState({ commit }) {
    commit(types.CLEAR_CURRENT_CHAT_WINDOW);
  },

  fetchPreviousMessages: async ({ commit }, data) => {
    try {
      const {
        data: { meta, payload },
      } = await MessageApi.getPreviousMessages(data);
      commit(`conversationMetadata/${types.SET_CONVERSATION_METADATA}`, {
        id: data.conversationId,
        data: meta,
      });
      commit(types.SET_PREVIOUS_CONVERSATIONS, {
        id: data.conversationId,
        data: payload,
      });
      if (payload.length < 20) {
        commit(types.SET_ALL_MESSAGES_LOADED);
      }
    } catch (error) {
      // Handle error
    }
  },

  async setActiveChat({ commit, dispatch }, data) {
    commit(types.SET_CURRENT_CHAT_WINDOW, data);
    commit(types.CLEAR_ALL_MESSAGES_LOADED);

    if (data.dataFetched === undefined) {
      try {
        await dispatch('fetchPreviousMessages', {
          conversationId: data.id,
          before: data.messages[0].id,
        });
        Vue.set(data, 'dataFetched', true);
      } catch (error) {
        // Ignore error
      }
    }
  },

  assignAgent: async ({ dispatch }, { conversationId, agentId }) => {
    try {
      const response = await ConversationApi.assignAgent({
        conversationId,
        agentId,
      });
      dispatch('setCurrentChatAssignee', response.data);
    } catch (error) {
      // Handle error
    }
  },

  setCurrentChatAssignee({ commit }, assignee) {
    commit(types.ASSIGN_AGENT, assignee);
  },

  assignTeam: async ({ dispatch }, { conversationId, teamId }) => {
    try {
      const response = await ConversationApi.assignTeam({
        conversationId,
        teamId,
      });
      dispatch('setCurrentChatTeam', response.data);
    } catch (error) {
      // Handle error
    }
  },

  setCurrentChatTeam({ commit }, team) {
    commit(types.ASSIGN_TEAM, team);
  },

  toggleStatus: async (
    { commit },
    { conversationId, status, snoozedUntil = null }
  ) => {
    try {
      const {
        data: {
          payload: {
            current_status: updatedStatus,
            snoozed_until: updatedSnoozedUntil,
          } = {},
        } = {},
      } = await ConversationApi.toggleStatus({
        conversationId,
        status,
        snoozedUntil,
      });
      commit(types.CHANGE_CONVERSATION_STATUS, {
        conversationId,
        status: updatedStatus,
        snoozedUntil: updatedSnoozedUntil,
      });
    } catch (error) {
      // Handle error
    }
  },

  sendMessage: async ({ commit }, data) => {
    // eslint-disable-next-line no-useless-catch
    try {
      const pendingMessage = createPendingMessage(data);
      commit(types.ADD_MESSAGE, pendingMessage);
      const response = await MessageApi.create(pendingMessage);
      commit(types.ADD_MESSAGE, {
        ...response.data,
        status: MESSAGE_STATUS.SENT,
      });
    } catch (error) {
      throw error;
    }
  },

  addMessage({ commit }, message) {
    commit(types.ADD_MESSAGE, message);
    if (message.message_type === MESSAGE_TYPE.INCOMING) {
      commit(types.SET_CONVERSATION_CAN_REPLY, {
        conversationId: message.conversation_id,
        canReply: true,
      });
    }
  },

  updateMessage({ commit }, message) {
    commit(types.ADD_MESSAGE, message);
  },

  deleteMessage: async function deleteLabels(
    { commit },
    { conversationId, messageId }
  ) {
    try {
      const response = await MessageApi.delete(conversationId, messageId);
      const { data } = response;
      // The delete message is actually deleting the content.
      commit(types.ADD_MESSAGE, data);
    } catch (error) {
      throw new Error(error);
    }
  },

  addConversation({ commit, state, dispatch }, conversation) {
    const { currentInbox, appliedFilters } = state;
    const {
      inbox_id: inboxId,
      meta: { sender },
    } = conversation;
    const hasAppliedFilters = !!appliedFilters.length;
    const isMatchingInboxFilter =
      !currentInbox || Number(currentInbox) === inboxId;
    if (!hasAppliedFilters && isMatchingInboxFilter) {
      commit(types.ADD_CONVERSATION, conversation);
      dispatch('contacts/setContact', sender);
    }
  },

  updateConversation({ commit, dispatch }, conversation) {
    const {
      meta: { sender },
    } = conversation;
    commit(types.UPDATE_CONVERSATION, conversation);
    dispatch('contacts/setContact', sender);
  },

  markMessagesRead: async ({ commit }, data) => {
    try {
      const {
        data: { id, agent_last_seen_at: lastSeen },
      } = await ConversationApi.markMessageRead(data);
      setTimeout(() => commit(types.MARK_MESSAGE_READ, { id, lastSeen }), 4000);
    } catch (error) {
      // Handle error
    }
  },

  setChatFilter({ commit }, data) {
    commit(types.CHANGE_CHAT_STATUS_FILTER, data);
  },

  updateAssignee({ commit }, data) {
    commit(types.UPDATE_ASSIGNEE, data);
  },

  updateConversationContact({ commit }, data) {
    if (data.id) {
      commit(`contacts/${types.SET_CONTACT_ITEM}`, data);
    }
    commit(types.UPDATE_CONVERSATION_CONTACT, data);
  },

  setActiveInbox({ commit }, inboxId) {
    commit(types.SET_ACTIVE_INBOX, inboxId);
  },

  muteConversation: async ({ commit }, conversationId) => {
    try {
      await ConversationApi.mute(conversationId);
      commit(types.MUTE_CONVERSATION);
    } catch (error) {
      //
    }
  },

  unmuteConversation: async ({ commit }, conversationId) => {
    try {
      await ConversationApi.unmute(conversationId);
      commit(types.UNMUTE_CONVERSATION);
    } catch (error) {
      //
    }
  },

  sendEmailTranscript: async (_, { conversationId, email }) => {
    try {
      await ConversationApi.sendEmailTranscript({ conversationId, email });
    } catch (error) {
      throw new Error(error);
    }
  },

  updateCustomAttributes: async (
    { commit },
    { conversationId, customAttributes }
  ) => {
    try {
      const response = await ConversationApi.updateCustomAttributes({
        conversationId,
        customAttributes,
      });
      const { custom_attributes } = response.data;
      commit(types.UPDATE_CONVERSATION_CUSTOM_ATTRIBUTES, custom_attributes);
    } catch (error) {
      // Handle error
    }
  },

  setConversationFilters({ commit }, data) {
    commit(types.SET_CONVERSATION_FILTERS, data);
  },

  clearConversationFilters({ commit }) {
    commit(types.CLEAR_CONVERSATION_FILTERS);
  },
};

export default actions;
